// Blocks Data Gateway persistence for the TestPilot domain records. The
// schemas live under blocks/data/schemas and are pushed with the Blocks CLI;
// every runtime call here goes through the shared SDK client (never a raw
// fetch). Gateway records are flat field bags identified by ItemId, so each
// app record carries its logical id in the `key` field and this module keeps
// key -> ItemId registries for updates. Timestamps are DateTime fields
// (ISO strings) -- GraphQL Int is 32-bit, so raw epoch milliseconds would
// overflow. Every run is runner-backed: real specs execute on the local
// runner service and the per-case rows persist in the CaseResult schema.
import { blocksClient } from "./client";
import {
  type CaseStep,
  type Environment,
  type Issue,
  type IssueEvent,
  type IssueSeverity,
  type IssueStatus,
  type Project,
  type ProjectIcon,
  type Run,
  type RunStatus,
  type Suite,
  type SuiteStatus
} from "../demo/data";
import type { TranslationKey } from "../i18n/dictionary";

type DataRecord = Record<string, unknown>;
type SchemaName = "Project" | "Suite" | "Run" | "Issue" | "TestSpec" | "CaseResult" | "UserPreference";

// Domain schemas wiped by deleteAllDomain. UserPreference is deliberately
// excluded: a demo-data reset must not clear the signed-in user's avatar.
const SCHEMAS: SchemaName[] = ["Project", "Suite", "Run", "Issue", "TestSpec", "CaseResult"];

// Must match the pushed schemas exactly. System fields (ItemId, CreatedDate,
// CreatedBy, ...) are managed by the gateway and never listed here.
const FIELDS: Record<SchemaName, string[]> = {
  Project: ["key", "name", "description", "icon", "tagsJson", "createdAt", "orgId"],
  Suite: ["key", "projectId", "name", "description", "status", "owner", "lastUpdatedAt", "orgId"],
  Run: ["key", "name", "projectId", "suiteId", "environment", "status", "total", "passed", "failed", "durationSec", "startedAt", "triggeredBy", "browser", "progress", "orgId"],
  Issue: ["key", "title", "projectId", "runId", "severity", "status", "message", "stepsJson", "assignee", "createdAt", "updatedAt", "historyJson", "orgId"],
  TestSpec: ["key", "projectId", "filename", "content", "baseURL", "updatedAt", "orgId"],
  CaseResult: ["key", "runId", "projectId", "name", "status", "durationMs", "errorMessage", "sortOrder", "orgId"],
  UserPreference: ["key", "avatarFileId", "updatedAt"]
};

// Gateway query names pluralize the schema name (Project -> getProjects).
const queryName = (schema: SchemaName) => `${schema}s`;

function domainCollection(schema: SchemaName) {
  return blocksClient.data.collection<DataRecord>(schema, { fields: [...FIELDS[schema]] });
}

// The gateway intermittently answers 401 / AUTH_NOT_AUTHENTICATED to requests
// that carry the exact same session as their 200 neighbours -- identical
// retries of one call have been seen flip 200 → 200 → 401, and a burst of
// parallel lists loses a random member. It is a flaky validation hop on the
// gateway side, not a dead session (the user stays signed in throughout), so
// these failures are worth a quick bounded retry instead of surfacing as a
// failed workspace load or a failed import. The bursts are seconds long (an
// import once took three 401s across ~3s before succeeding on a manual
// retry), so the schedule spans ~7s: five attempts at 400ms/900ms/2s/3.5s.
// A genuinely dead session still errors out, just later.
//
// Worse, the gateway sometimes ACCEPTS a request and never answers at all
// (a POST left pending for minutes). The SDK sets no timeout, so the await
// would hang forever and the Tests tab would show an empty workspace with
// no error at all. Every call therefore races a timeout, and a timed-out
// call is retried exactly like a rejected one.
const TRANSIENT_RETRY_DELAYS_MS = [400, 900, 2_000, 3_500];
// The import path needs to be stubborn: a degraded gateway span once ate a
// whole 36-file import (every attempt hung to the timeout, then the final
// "list timed out" failed the run), and spans have now been observed past
// 90 seconds. The import budget waits ~80s across 8 attempts with a 20s
// per-attempt timeout (~4min worst case), so a span has to outlast four
// minutes to kill an import — nothing client-side can bridge more.
const IMPORT_RETRY_DELAYS_MS = [1_000, 3_000, 6_000, 10_000, 15_000, 20_000, 25_000];
const IMPORT_CALL_TIMEOUT_MS = 20_000;
const GATEWAY_CALL_TIMEOUT_MS = 10_000;

function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes("timed out after")) return true;
  // HTTP2 protocol errors / dropped connections — the browser surfaces them
  // as generic fetch failures. A request that died in-flight almost never
  // reached the gateway, so a retry is safe (same trade-off as the hang
  // retries below: a late orphan write may duplicate a row).
  if (/failed to fetch|networkerror|network error|err_http|http2/i.test(error.message)) return true;
  if (error.name === "BlocksApiError" && /\b401\b/.test(error.message)) return true;
  return /AUTH_NOT_AUTHENTICATED|not authenticated/i.test(error.message);
}

async function withTransientAuthRetry<T>(
  what: string,
  call: () => Promise<T>,
  retryDelays: number[] = TRANSIENT_RETRY_DELAYS_MS,
  timeoutMs: number = GATEWAY_CALL_TIMEOUT_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
    try {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
        call().then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); }
        );
      });
    } catch (error) {
      lastError = error;
      if (!isTransientFailure(error)) throw error;
    }
  }
  throw lastError;
}

/** Wrap every collection method so all reads/writes ride through the retry.
 *  Only transient auth blips and gateway hangs retry; other errors propagate
 *  untouched. A late answer to an abandoned create can duplicate a row (the
 *  retry writes a fresh record) -- rare, and far cheaper than an app that
 *  hangs forever. */
function withTransientAuthRetryWrapped<T extends object>(
  collection: T,
  retryDelays: number[] = TRANSIENT_RETRY_DELAYS_MS,
  timeoutMs: number = GATEWAY_CALL_TIMEOUT_MS
): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(collection)) {
    if (typeof value !== "function") {
      wrapped[name] = value;
      continue;
    }
    wrapped[name] = (...args: unknown[]) => withTransientAuthRetry(name, () => (value as (...a: unknown[]) => Promise<unknown>).apply(collection, args), retryDelays, timeoutMs);
  }
  return wrapped as T;
}

const collections: Record<SchemaName, ReturnType<typeof domainCollection>> = {
  Project: withTransientAuthRetryWrapped(domainCollection("Project")),
  Suite: withTransientAuthRetryWrapped(domainCollection("Suite")),
  Run: withTransientAuthRetryWrapped(domainCollection("Run")),
  Issue: withTransientAuthRetryWrapped(domainCollection("Issue")),
  TestSpec: withTransientAuthRetryWrapped(domainCollection("TestSpec")),
  CaseResult: withTransientAuthRetryWrapped(domainCollection("CaseResult")),
  UserPreference: withTransientAuthRetryWrapped(domainCollection("UserPreference"))
};

// Logical id (`key`) -> gateway ItemId, filled on every full load and on
// creates, so later patches can address the right record.
const itemIds: Record<SchemaName, Map<string, string>> = {
  Project: new Map(),
  Suite: new Map(),
  Run: new Map(),
  Issue: new Map(),
  TestSpec: new Map(),
  CaseResult: new Map(),
  UserPreference: new Map()
};

const CREATE_BATCH = 5;
const DELETE_CHUNK = 10;
// Conservative page size: the SDK defaults to 20 and no documented cap
// exists, so stay near what the skill examples use instead of assuming a
// large one is allowed.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
// TestSpec pages carry whole file contents, and page latency grows with the
// CONTENT bytes, not the row count: 100 records answered in ~2s without the
// content field but took 13s+ (or never answered at all) with it once one
// project's workspace grew past ~280 files. Small pages keep every response
// in the fast zone; listRecords fetches the remaining pages in parallel so
// total wall time stays sane.
const PAGE_SIZE_BY_SCHEMA: Partial<Record<SchemaName, number>> = { TestSpec: 25 };
const MAX_PAGES_BY_SCHEMA: Partial<Record<SchemaName, number>> = { TestSpec: 40 };

function pageSizeOf(schema: SchemaName): number {
  return PAGE_SIZE_BY_SCHEMA[schema] ?? PAGE_SIZE;
}

function maxPagesOf(schema: SchemaName): number {
  return MAX_PAGES_BY_SCHEMA[schema] ?? MAX_PAGES;
}

// ---------------------------------------------------------------------------
// Response normalization -- the SDK returns untyped envelopes, so every read
// is narrowed at this boundary.
// ---------------------------------------------------------------------------
/**
 * GraphQL answers come back HTTP 200 even when the operation failed -- the
 * errors ride in the body. The SDK's http client only throws on non-2xx, so
 * every gateway result MUST pass through here: otherwise a rejected insert
 * or query would quietly look like "no records" and the app would render
 * empty pages with nothing in the console.
 */
function assertGateway(response: unknown, what: string): Record<string, unknown> {
  const envelope = (response ?? {}) as { data?: unknown; errors?: unknown };
  const errors = Array.isArray(envelope.errors) ? (envelope.errors as { message?: unknown }[]) : [];
  const first = errors[0];
  if (first) {
    const message = typeof first.message === "string" && first.message ? first.message : "unknown gateway error";
    throw new Error(`${what} failed: ${message}`);
  }
  if (!envelope.data || typeof envelope.data !== "object") {
    throw new Error(`${what} failed: gateway returned no data`);
  }
  return envelope.data as Record<string, unknown>;
}

function itemsOf(data: Record<string, unknown>, query: string): DataRecord[] {
  const gateway = data[query];
  const nested = gateway && typeof gateway === "object" ? (gateway as { items?: unknown }).items : undefined;
  const items = nested ?? (data as { items?: unknown }).items;
  return Array.isArray(items) ? (items as DataRecord[]) : [];
}

/** totalCount rides next to items and may arrive as a GraphQL Long, i.e. a
 *  JSON string. Missing/odd values fall back to the items actually read. */
function totalCountOf(data: Record<string, unknown>, query: string, items: DataRecord[]): number {
  const gateway = data[query];
  const raw = gateway && typeof gateway === "object" ? (gateway as { totalCount?: unknown }).totalCount : undefined;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= items.length ? value : items.length;
}

function recordItemId(record: DataRecord): string | undefined {
  const value = record.ItemId ?? record.itemId;
  return typeof value === "string" && value ? value : undefined;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function asTimestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function asJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

// ---------------------------------------------------------------------------
// Organization scoping
// ---------------------------------------------------------------------------
// The gateway is TENANT-scoped: every organization in the tenant reads the
// same rows and a record carries no org dimension of its own. The active org
// id is held here, stamped onto every domain write and matched on every
// domain read. AuthProvider keeps it synced from the session claims and the
// OrgSwitcher sets it before a switch's reload, so the load only ever sees
// the active org's rows. Rows without an orgId predate scoping -- they count
// as Default-org data and stay visible only while the Default org is active.
let activeOrgId = "default";
let orgChangeHandlers: (() => void)[] = [];

function normalizeOrgId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

/** Re-scope every domain read/write to an org. Returns whether the scope
 *  actually changed; a change notifies subscribers (the demo store resets
 *  itself on one, clearing the previous org's rows). */
export function setDataOrgId(orgId: string | undefined): boolean {
  const next = normalizeOrgId(orgId);
  if (next === activeOrgId) return false;
  activeOrgId = next;
  for (const handler of [...orgChangeHandlers]) handler();
  return true;
}

/** Subscribe to active-org changes; returns the unsubscribe function. */
export function onActiveOrgChange(handler: () => void): () => void {
  orgChangeHandlers.push(handler);
  return () => {
    orgChangeHandlers = orgChangeHandlers.filter((entry) => entry !== handler);
  };
}

/** Rows without orgId predate scoping -- Default-org data only. */
function recordMatchesActiveOrg(record: DataRecord): boolean {
  const org = asString(record.orgId);
  return org ? org === activeOrgId : activeOrgId === "default";
}

/** Stamp the active org onto a record about to be written. */
function withOrgTag(record: DataRecord): DataRecord {
  return { ...record, orgId: activeOrgId };
}

// ---------------------------------------------------------------------------
// Record <-> app-type mapping
// ---------------------------------------------------------------------------
function fromProjectRecord(record: DataRecord): Project {
  return {
    id: asString(record.key),
    name: asString(record.name),
    description: asString(record.description),
    icon: asString(record.icon, "globe") as ProjectIcon,
    tags: asJson<string[]>(record.tagsJson, []),
    createdAt: asTimestamp(record.createdAt)
  };
}

function toProjectRecord(project: Project): DataRecord {
  return withOrgTag({
    key: project.id,
    name: project.name,
    description: project.description,
    icon: project.icon,
    tagsJson: JSON.stringify(project.tags),
    createdAt: iso(project.createdAt)
  });
}

function fromSuiteRecord(record: DataRecord): Suite {
  return {
    id: asString(record.key),
    projectId: asString(record.projectId),
    name: asString(record.name),
    description: asString(record.description),
    status: asString(record.status, "active") as SuiteStatus,
    owner: asString(record.owner),
    lastUpdatedAt: asTimestamp(record.lastUpdatedAt)
  };
}

function toSuiteRecord(suite: Suite): DataRecord {
  return withOrgTag({
    key: suite.id,
    projectId: suite.projectId,
    name: suite.name,
    description: suite.description,
    status: suite.status,
    owner: suite.owner,
    lastUpdatedAt: iso(suite.lastUpdatedAt)
  });
}

function fromRunRecord(record: DataRecord): Run {
  const progress = record.progress;
  const trigger = asString(record.trigger);
  return {
    id: asString(record.key),
    name: asString(record.name),
    projectId: asString(record.projectId),
    suiteId: asString(record.suiteId),
    environment: asString(record.environment, "staging") as Environment,
    status: asString(record.status, "passed") as RunStatus,
    total: asInt(record.total),
    passed: asInt(record.passed),
    failed: asInt(record.failed),
    durationSec: asInt(record.durationSec),
    startedAt: asTimestamp(record.startedAt),
    triggeredBy: asString(record.triggeredBy),
    browser: asString(record.browser, "chromium") as Run["browser"],
    // Legacy rows predate this field and stay undefined — runTrigger()
    // infers them from the id prefix / actor.
    ...(trigger ? { trigger: trigger as Run["trigger"] } : {}),
    progress: typeof progress === "number" && Number.isFinite(progress) ? progress : undefined
  };
}

function toRunRecord(run: Run): DataRecord {
  // No `trigger` here on purpose: the pushed Run schema has no such column
  // and the gateway REJECTS unknown fields outright ("field `trigger` does
  // not exist on RunInsertInput") — sending it failed every runner-run
  // create silently, losing the record. runTrigger() reconstructs the
  // trigger from the id prefix / actor when the row is read back.
  return withOrgTag({
    key: run.id,
    name: run.name,
    projectId: run.projectId,
    suiteId: run.suiteId,
    environment: run.environment,
    status: run.status,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    durationSec: run.durationSec,
    startedAt: iso(run.startedAt),
    triggeredBy: run.triggeredBy,
    browser: run.browser,
    ...(run.progress !== undefined ? { progress: run.progress } : {})
  });
}

function fromIssueRecord(record: DataRecord): Issue {
  const history = asJson<IssueEvent[]>(record.historyJson, []).map((event) => ({
    at: asTimestamp(event.at),
    actor: asString(event.actor),
    labelKey: asString(event.labelKey) as TranslationKey
  }));
  return {
    id: asString(record.key),
    title: asString(record.title),
    projectId: asString(record.projectId),
    runId: asString(record.runId) || undefined,
    severity: asString(record.severity, "medium") as IssueSeverity,
    status: asString(record.status, "open") as IssueStatus,
    message: asString(record.message),
    steps: asJson<string[]>(record.stepsJson, []),
    assignee: asString(record.assignee),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
    history
  };
}

function toIssueRecord(issue: Issue): DataRecord {
  return withOrgTag({
    key: issue.id,
    title: issue.title,
    projectId: issue.projectId,
    ...(issue.runId ? { runId: issue.runId } : {}),
    severity: issue.severity,
    status: issue.status,
    message: issue.message,
    stepsJson: JSON.stringify(issue.steps),
    assignee: issue.assignee,
    createdAt: iso(issue.createdAt),
    updatedAt: iso(issue.updatedAt),
    historyJson: JSON.stringify(issue.history)
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
async function listPage(schema: SchemaName, pageNo: number, pageSize: number, query: string, collection: ReturnType<typeof domainCollection> = collections[schema]): Promise<DataRecord[]> {
  const response = await collection.list({ pageNo, pageSize });
  // The gateway nests results under the operation name (getProjects), not
  // the bare plural -- looking up "Projects" read [] out of a full response,
  // which made every load see an empty tenant, reseed and render zero rows.
  return itemsOf(assertGateway(response, `List ${schema}`), query);
}

async function listRecords(schema: SchemaName, collection: ReturnType<typeof domainCollection> = collections[schema]): Promise<DataRecord[]> {
  const pageSize = pageSizeOf(schema);
  const query = `get${queryName(schema)}`;
  // Page 1 answers first and reports totalCount, which sizes the rest --
  // so the remaining pages can run concurrently instead of serially
  // stacking their latencies (the gateway's per-page cost dominates).
  const firstResponse = assertGateway(await collection.list({ pageNo: 1, pageSize }), `List ${schema}`);
  const firstItems = itemsOf(firstResponse, query);
  const total = totalCountOf(firstResponse, query, firstItems);
  const totalPages = Math.min(maxPagesOf(schema), Math.max(1, Math.ceil(total / pageSize)));
  if (totalPages === 1) return firstItems;
  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => listPage(schema, index + 2, pageSize, query, collection))
  );
  return [...firstItems, ...rest.flat()];
}

/**
 * List every record, paging past the app's display cap until a short page
 * says the collection is exhausted. Cleanup paths need this: a collection
 * larger than MAX_PAGES * page size hides matches from the capped read, and
 * records beyond it would silently survive a delete.
 */
async function listAllRecords(schema: SchemaName): Promise<DataRecord[]> {
  const pageSize = pageSizeOf(schema);
  const all: DataRecord[] = [];
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const items = await listPage(schema, pageNo, pageSize, `get${queryName(schema)}`);
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

export type DomainSnapshot = { projects: Project[]; suites: Suite[]; runs: Run[]; issues: Issue[] };

async function listDomain(): Promise<DomainSnapshot> {
  const [allProjects, allSuites, allRuns, allIssues] = await Promise.all([
    listRecords("Project"),
    listRecords("Suite"),
    listRecords("Run"),
    listRecords("Issue")
  ]);
  // Org scope: rows tagged for another organization never enter the
  // snapshot, and legacy untagged rows surface only under the Default org.
  const projectRecords = allProjects.filter(recordMatchesActiveOrg);
  const suiteRecords = allSuites.filter(recordMatchesActiveOrg);
  const runRecords = allRuns.filter(recordMatchesActiveOrg);
  const issueRecords = allIssues.filter(recordMatchesActiveOrg);
  const projects: Project[] = [];
  for (const record of projectRecords) {
    const project = fromProjectRecord(record);
    const itemId = recordItemId(record);
    if (project.id && itemId) itemIds.Project.set(project.id, itemId);
    projects.push(project);
  }
  const suites: Suite[] = [];
  for (const record of suiteRecords) {
    const suite = fromSuiteRecord(record);
    const itemId = recordItemId(record);
    if (suite.id && itemId) itemIds.Suite.set(suite.id, itemId);
    suites.push(suite);
  }
  const runs: Run[] = [];
  for (const record of runRecords) {
    const run = fromRunRecord(record);
    const itemId = recordItemId(record);
    if (run.id && itemId) itemIds.Run.set(run.id, itemId);
    runs.push(run);
  }
  const issues: Issue[] = [];
  for (const record of issueRecords) {
    const issue = fromIssueRecord(record);
    const itemId = recordItemId(record);
    if (issue.id && itemId) itemIds.Issue.set(issue.id, itemId);
    issues.push(issue);
  }
  return { projects, suites, runs, issues };
}

/**
 * Full load used by the app store: lists the gateway collections and returns
 * them as-is. An empty tenant stays empty — the deterministic seed generators
 * no longer run anywhere (removed with the simulator), so neither a first run
 * nor "Reset demo data" can fabricate a history.
 */
export async function loadDomain(): Promise<DomainSnapshot> {
  return listDomain();
}

/** Runs only — the cross-browser adoption probe refreshes just this one
 *  collection while hunting for a run another browser dispatched; a full
 *  loadDomain every poll would be four collections for one check. */
export async function listRunRecords(): Promise<Run[]> {
  const runRecords = (await listRecords("Run")).filter(recordMatchesActiveOrg);
  const runs: Run[] = [];
  for (const record of runRecords) {
    const run = fromRunRecord(record);
    const itemId = recordItemId(record);
    if (run.id && itemId) itemIds.Run.set(run.id, itemId);
    runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Writes -- called fire-and-forget by the store: a failed cloud write must
// never break the UI; the record re-syncs on the next full load. The store
// still logs the rejection, so the reason stays visible in the console.
// ---------------------------------------------------------------------------
async function patchRecord(schema: SchemaName, key: string, record: DataRecord, createMissing = false): Promise<void> {
  let itemId = itemIds[schema].get(key);
  if (!itemId && createMissing) {
    // The initial create for this logical record was lost (the gateway
    // answers flaky 401s; the store swallows write errors by design). A
    // later patch must resurrect the row instead of vanishing into
    // nothing — an unknown key is created, never silently dropped.
    await createRecord(schema, record);
    return;
  }
  if (!itemId) return;
  assertGateway(await collections[schema].update(itemId, record), `Update ${schema}`);
}

/** Shared create for a logical record; fills the itemId registry on success. */
async function createRecord(schema: SchemaName, record: DataRecord): Promise<void> {
  const data = assertGateway(await collections[schema].create(record), `Insert ${schema}`);
  const mutation = schema === "Run" ? "insertRun" : schema === "Issue" ? "insertIssue" : schema === "Suite" ? "insertSuite" : schema === "Project" ? "insertProject" : null;
  if (!mutation) return;
  const result = (data as DataRecord)[mutation] as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds[schema].set(asString(record.key), itemId);
}

export async function createRunRecord(run: Run): Promise<void> {
  const data = assertGateway(await collections.Run.create(toRunRecord(run)), "Insert Run");
  const result = data.insertRun as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds.Run.set(run.id, itemId);
}

export function updateRunRecord(run: Run): Promise<void> {
  // createMissing: the dispatch-time create is fire-and-forget; a flaky
  // gateway must not leave a finished run with no record at all.
  return patchRecord("Run", run.id, toRunRecord(run), true);
}

export function updateIssueRecord(issue: Issue): Promise<void> {
  return patchRecord("Issue", issue.id, toIssueRecord(issue));
}

export async function createSuiteRecord(suite: Suite): Promise<void> {
  const data = assertGateway(await collections.Suite.create(toSuiteRecord(suite)), "Insert Suite");
  const result = data.insertSuite as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds.Suite.set(suite.id, itemId);
}

export async function createIssueRecord(issue: Issue): Promise<void> {
  const data = assertGateway(await collections.Issue.create(toIssueRecord(issue)), "Insert Issue");
  const result = data.insertIssue as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds.Issue.set(issue.id, itemId);
}

export async function createProjectRecord(project: Project): Promise<void> {
  const data = assertGateway(await collections.Project.create(toProjectRecord(project)), "Insert Project");
  const result = data.insertProject as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds.Project.set(project.id, itemId);
}

/**
 * Patch EVERY row sharing the logical key: a repeatedly-reseeded tenant can
 * hold several copies of a project, and updating only the registry's copy
 * would let the next reload revert the edit right in front of the user.
 */
export async function updateProjectRecord(project: Project): Promise<void> {
  const records = await listAllRecords("Project");
  const ids = records
    .filter((record) => asString(record.key) === project.id && recordMatchesActiveOrg(record))
    .map(recordItemId)
    .filter((id): id is string => Boolean(id));
  for (const itemId of ids) {
    assertGateway(await collections.Project.update(itemId, toProjectRecord(project)), "Update Project");
  }
  const [firstItemId] = ids;
  if (firstItemId) itemIds.Project.set(project.id, firstItemId);
}

/**
 * Bulk delete every row matching a where-filter in one gateway call. The
 * deleteMany<Suite|Run|Issue|Project> mutations exist on the gateway even
 * though they are absent from its mutationSchemas list. Returns the impacted
 * row count -- 0 means nothing matched and the caller can stop re-listing.
 */
async function deleteManyMatching(schema: SchemaName, where: DataRecord, retryDelays: number[] = TRANSIENT_RETRY_DELAYS_MS): Promise<number> {
  const mutation = `deleteMany${schema}`;
  const data = assertGateway(await withTransientAuthRetry(`Bulk delete ${schema}`, () => blocksClient.data.graphql({
    operationName: mutation,
    query: `mutation ${mutation}($where: ${schema}FilterInput, $input: ${schema}DeleteInput) { ${mutation}(where: $where, input: $input) { acknowledged totalImpactedData } }`,
    // RunDeleteInput.isHardDelete (introspected) -- the flag is REQUIRED on
    // the bulk input, and it is spelled isHardDelete, not hardDelete.
    variables: { where, input: { isHardDelete: true } }
  }), retryDelays), `Bulk delete ${schema}`);
  const result = data[mutation] as { acknowledged?: unknown; totalImpactedData?: unknown } | null | undefined;
  if (!result || result.acknowledged === false) {
    throw new Error(`${mutation} was not acknowledged`);
  }
  // totalImpactedData is a GraphQL Long: JSON may deliver it as a string.
  const raw = result.totalImpactedData;
  const impacted = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : 0;
  return impacted;
}

/**
 * Per-row fallback: relist until nothing matches, deleting in chunks. A
 * tenant that was reseeded repeatedly holds SEVERAL rows sharing the same
 * logical key (the registry only ever maps a key to one ItemId), so matches
 * must be found by a fresh list, not by the registry.
 */
async function deleteByRelist(schema: SchemaName, matches: (record: DataRecord) => boolean): Promise<void> {
  for (let pass = 0; pass < 50; pass++) {
    const records = await listAllRecords(schema);
    const ids = records.filter(matches).map(recordItemId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) break;
    for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK) {
      await Promise.all(ids.slice(offset, offset + DELETE_CHUNK).map(async (id) => {
        assertGateway(await collections[schema].delete(id, { hardDelete: true }), `Delete ${schema}`);
      }));
    }
  }
}

/**
 * Delete a project and everything hanging off it. Children go through the
 * bulk where-delete first -- a reseeded tenant can hold >1500 runs for one
 * key, and per-row chunk deletes at that scale take hundreds of gateway
 * calls (the original cleanup path timed out in exactly that trap). If the
 * gateway rejects the bulk DSL, the verified per-row passes still run, so a
 * delete never half-fails silently.
 */
export async function deleteProjectRecord(projectId: string): Promise<void> {
  for (const schema of ["Suite", "Run", "Issue", "TestSpec", "CaseResult"] as SchemaName[]) {
    try {
      for (let pass = 0; pass < 50; pass++) {
        const impacted = await deleteManyMatching(schema, { projectId });
        if (impacted === 0) break;
      }
    } catch (bulkError) {
      console.warn(`[TestPilot] Bulk delete ${schema} rejected, falling back to per-row deletes:`, bulkError);
      await deleteByRelist(schema, (record) => asString(record.projectId) === projectId);
    }
  }
  try {
    for (let pass = 0; pass < 50; pass++) {
      const impacted = await deleteManyMatching("Project", { key: projectId });
      if (impacted === 0) break;
    }
  } catch (bulkError) {
    console.warn("[TestPilot] Bulk delete Project rejected, falling back to per-row deletes:", bulkError);
    await deleteByRelist("Project", (record) => asString(record.key) === projectId);
  } finally {
    itemIds.Project.delete(projectId);
  }
}

/**
 * Settings > Danger zone: wipe every domain record OF THE ACTIVE ORG so a
 * fresh start begins there -- other organizations' rows are tenant siblings
 * and must survive a reset that was issued from a different one.
 */
export async function deleteAllDomain(): Promise<void> {
  for (const schema of SCHEMAS) {
    // List-and-delete in passes: listRecords reads at most
    // MAX_PAGES * PAGE_SIZE items, so one pass only reaches the first slice
    // of a collection larger than that (the duplicated-seed tenant had
    // thousands of runs) -- repeat until the list comes back empty.
    try {
      for (let pass = 0; pass < 50; pass++) {
        const records = (await listRecords(schema)).filter(recordMatchesActiveOrg);
        if (records.length === 0) break;
        const ids = records.map(recordItemId).filter((id): id is string => Boolean(id));
        for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK) {
          await Promise.all(ids.slice(offset, offset + DELETE_CHUNK).map(async (id) => {
            assertGateway(await collections[schema].delete(id, { hardDelete: true }), `Delete ${schema}`);
          }));
        }
      }
    } catch {
      // Keep wiping the remaining schemas; refresh reseeds whatever is gone.
    }
    itemIds[schema].clear();
  }
}

// ---------------------------------------------------------------------------
// Test workspace files (the project Tests tab). Every file of an imported
// codebase -- or a hand-written spec -- is one TestSpec record: key =
// "<projectId>:<path>", filename = the workspace-relative path. The v1
// single-spec record (key = projectId, one file per project) keeps working:
// listTestFiles maps it to a file entry by its filename and saving that path
// upgrades the record to the new key. Workspace-level settings (base URL)
// ride on a dedicated record whose path is SETTINGS_PATH, so file records
// stay purely file-shaped. Lists are small enough to read whole and filter
// client-side.
// ---------------------------------------------------------------------------
export type StoredFile = { path: string; content: string };
export type StoredWorkspace = { files: StoredFile[]; baseURL: string };

const SETTINGS_PATH = "__workspace__";
const settingsKeyOf = (projectId: string) => `${projectId}:${SETTINGS_PATH}`;
const fileKeyOf = (projectId: string, path: string) => `${projectId}:${path}`;

export async function loadTestWorkspace(projectId: string): Promise<StoredWorkspace> {
  const records = await listRecords("TestSpec");
  const files: StoredFile[] = [];
  const seenPaths = new Set<string>();
  let baseURL = "";
  for (const record of records) {
    if (!recordMatchesActiveOrg(record)) continue;
    if (asString(record.projectId) !== projectId) continue;
    if (asString(record.key) === settingsKeyOf(projectId)) {
      baseURL = parseWorkspaceSettings(asString(record.content)).baseURL ?? "";
      continue;
    }
    const path = asString(record.filename);
    if (!path || seenPaths.has(path)) continue;
    seenPaths.add(path);
    files.push({ path, content: asString(record.content) });
    // v1 stored the base URL on the spec record itself; seed from it when no
    // dedicated settings record exists yet.
    if (!baseURL && asString(record.key) === projectId) baseURL = asString(record.baseURL);
  }
  return { files, baseURL };
}

export async function saveTestFile(input: { projectId: string; path: string; content: string }): Promise<void> {
  const key = fileKeyOf(input.projectId, input.path);
  const payload: DataRecord = withOrgTag({
    key,
    projectId: input.projectId,
    filename: input.path,
    content: input.content,
    baseURL: "",
    updatedAt: iso(Date.now())
  });
  // Update by remembered ItemId, else find it by key or v1 filename match
  // (which also upgrades a legacy record to the new key); create when absent.
  let itemId = itemIds.TestSpec.get(key);
  if (!itemId) {
    const records = await listRecords("TestSpec");
    itemId = records
      .filter((record) =>
        recordMatchesActiveOrg(record) &&
        asString(record.projectId) === input.projectId &&
        (asString(record.key) === key || (asString(record.key) === input.projectId && asString(record.filename) === input.path)))
      .map(recordItemId)
      .find((id): id is string => Boolean(id));
  }
  if (itemId) {
    itemIds.TestSpec.set(key, itemId);
    assertGateway(await collections.TestSpec.update(itemId, payload), "Update TestSpec");
    return;
  }
  const data = assertGateway(await collections.TestSpec.create(payload), "Insert TestSpec");
  const result = data.insertTestSpec as { itemId?: unknown } | null | undefined;
  const created = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (created) itemIds.TestSpec.set(key, created);
}

/**
 * Delete one workspace file's record. No-op when the row is already
 * gone (the tree may hold a file the gateway never stored, e.g. the
 * unsaved starter spec).
 */
export async function deleteTestFile(input: { projectId: string; path: string }): Promise<void> {
  const key = fileKeyOf(input.projectId, input.path);
  let itemId = itemIds.TestSpec.get(key);
  if (!itemId) {
    const records = await listRecords("TestSpec");
    itemId = records
      .filter((record) =>
        recordMatchesActiveOrg(record) &&
        asString(record.projectId) === input.projectId &&
        (asString(record.key) === key || (asString(record.key) === input.projectId && asString(record.filename) === input.path)))
      .map(recordItemId)
      .find((id): id is string => Boolean(id));
  }
  if (!itemId) return;
  assertGateway(await collections.TestSpec.delete(itemId), "Delete TestSpec");
  itemIds.TestSpec.delete(key);
}

/** Workspace-level settings persisted beside the spec files, as JSON on the
 *  dedicated `__workspace__` record. The browser that opened the folder
 *  publishes its runner binding (root + spec paths) here, so every OTHER
 *  browser can render the same suite spec list — the runner reads the same
 *  files on this machine regardless of which browser asks. */
export type WorkspaceSettings = {
  baseURL?: string;
  root?: string;
  mode?: "fsa" | "runner";
  specPaths?: string[];
};

function parseWorkspaceSettings(content: string): WorkspaceSettings {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as WorkspaceSettings;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Legacy records stored the bare base-URL string.
  }
  return { baseURL: content };
}

/** Merge-write: patches keep fields other callers set (baseURL vs the
 *  runner binding) so one writer never clobbers another. */
export async function saveWorkspaceSettings(input: { projectId: string } & WorkspaceSettings): Promise<void> {
  const records = await listRecords("TestSpec");
  const existing = records.find((record) => recordMatchesActiveOrg(record) && asString(record.key) === settingsKeyOf(input.projectId));
  const current = parseWorkspaceSettings(existing ? asString(existing.content) : "");
  const { projectId, ...patch } = input;
  await saveTestFile({ projectId, path: SETTINGS_PATH, content: JSON.stringify({ ...current, ...patch }) });
}

export async function loadWorkspaceSettings(projectId: string): Promise<WorkspaceSettings | null> {
  const records = await listRecords("TestSpec");
  const record = records.find((entry) => recordMatchesActiveOrg(entry) && asString(entry.key) === settingsKeyOf(projectId));
  if (!record) return null;
  const settings = parseWorkspaceSettings(asString(record.content));
  return Object.keys(settings).length > 0 ? settings : null;
}

/** Live import state surfaced in the explorer and the status bar, so a
 *  long import (36 files ≈ 30s on the flaky gateway) is never silent. */
export type ImportProgress = { phase: "clearing" | "writing" | "reading"; done: number; total: number };

/**
 * Import: replace the project's whole file set in one go. Delete-then-create
 * keeps the stored tree identical to the imported one (no ghost files left
 * over from a previous workspace).
 *
 * Every gateway write goes strictly one at a time with a short gap. Bursty
 * parallel batches were what tipped the gateway into its HTTP2-error/hang
 * spans, which then killed whole imports mid-flight — serialized writes are
 * slower but survive. Each write carries the import-sized retry budget, and
 * onProgress reports the clearing/writing phases as they advance.
 */
export async function replaceTestFiles(input: {
  projectId: string;
  files: StoredFile[];
  onProgress?: (progress: ImportProgress) => void;
}): Promise<void> {
  const IMPORT_WRITE_GAP_MS = 200;
  const report = (phase: ImportProgress["phase"], done: number, total: number) =>
    input.onProgress?.({ phase, done, total });
  const gap = () => new Promise((resolve) => setTimeout(resolve, IMPORT_WRITE_GAP_MS));
  // A dedicated TestSpec collection with the import-sized retry budget: the
  // degraded gateway spans outlast the normal budget, and an import is
  // exactly the moment to be stubborn.
  const specs = withTransientAuthRetryWrapped(domainCollection("TestSpec"), IMPORT_RETRY_DELAYS_MS, IMPORT_CALL_TIMEOUT_MS);

  report("clearing", 0, 0);
  // The gateway has no deleteManyTestSpec mutation (bulk delete 400s
  // deterministically — only Suite/Run/Issue/Project have one), so imports
  // go straight to the reliable path: list this project's rows, delete
  // them one by one. For an empty workspace this is a single list call.
  const existing = await listRecords("TestSpec", specs);
  const staleIds = existing
    .filter((record) => recordMatchesActiveOrg(record) && asString(record.projectId) === input.projectId)
    .map(recordItemId)
    .filter((id): id is string => Boolean(id));
  for (const id of staleIds) {
    assertGateway(await specs.delete(id), "Delete TestSpec");
    await gap();
  }
  for (const key of [...itemIds.TestSpec.keys()]) {
    if (key.startsWith(`${input.projectId}:`)) itemIds.TestSpec.delete(key);
  }

  const files = input.files.filter((file) => file.path && file.path !== SETTINGS_PATH);
  let created = 0;
  for (const file of files) {
    const key = fileKeyOf(input.projectId, file.path);
    const data = assertGateway(await specs.create(withOrgTag({
      key,
      projectId: input.projectId,
      filename: file.path,
      content: file.content,
      baseURL: "",
      updatedAt: iso(Date.now())
    })), `Insert TestSpec ${file.path}`);
    const result = data.insertTestSpec as { itemId?: unknown } | null | undefined;
    const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
    if (itemId) itemIds.TestSpec.set(key, itemId);
    created += 1;
    report("writing", created, files.length);
    await gap();
  }
}

export type StoredCase = {
  id: string;
  runId: string;
  projectId: string;
  name: string;
  status: string;
  durationMs: number;
  error: string;
  order: number;
  /** Workspace-relative spec path — sent when the gateway tolerates it. */
  file?: string;
  /** The case's test.step results, JSON-packed into stepsJson the same way
   *  Issue rows carry historyJson. Absent when the gateway dropped them. */
  steps?: CaseStep[];
};

// Whether the gateway accepted the extra per-case columns. Discovered on the
// first write: the pushed CaseResult schema predates file/stepsJson, and a
// schema that rejects unknown fields would fail every rich create. One
// rejection flips this off for the session — plain rows still persist, and
// the localStorage case-detail registry (shared/caseDetailRegistry.ts) keeps
// steps alive across reloads instead.
let caseDetailPersist = true;

export async function createCaseRecords(runId: string, projectId: string, cases: StoredCase[]): Promise<void> {
  for (let offset = 0; offset < cases.length; offset += CREATE_BATCH) {
    await Promise.all(cases.slice(offset, offset + CREATE_BATCH).map(async (entry) => {
      const base: DataRecord = withOrgTag({
        key: entry.id,
        runId,
        projectId,
        name: entry.name,
        status: entry.status,
        durationMs: entry.durationMs,
        errorMessage: entry.error,
        sortOrder: entry.order
      });
      if (caseDetailPersist && (entry.file || entry.steps?.length)) {
        try {
          await assertGateway(await collections.CaseResult.create({
            ...base,
            file: entry.file ?? "",
            stepsJson: entry.steps?.length ? JSON.stringify(entry.steps) : ""
          }), "Insert CaseResult");
          return;
        } catch {
          // Schema likely lacks the columns — retry plain so the row itself
          // still persists, and stop trying for the rest of the session.
          caseDetailPersist = false;
        }
      }
      await assertGateway(await collections.CaseResult.create(base), "Insert CaseResult");
    }));
  }
}

/** Every persisted case row; the store groups them by run for the run pages. */
export async function listCaseRecords(): Promise<StoredCase[]> {
  const records = (await listRecords("CaseResult")).filter(recordMatchesActiveOrg);
  return records.map((record, index) => {
    const steps = asJson<CaseStep[]>(record.stepsJson, []);
    return {
      id: asString(record.key),
      runId: asString(record.runId),
      projectId: asString(record.projectId),
      name: asString(record.name),
      status: asString(record.status, "failed"),
      durationMs: asInt(record.durationMs),
      error: asString(record.errorMessage),
      order: asInt(record.sortOrder, index),
      ...(asString(record.file) ? { file: asString(record.file) } : {}),
      ...(steps.length ? { steps } : {})
    };
  });
}

// ---------------------------------------------------------------------------
// User preferences -- currently just the profile avatar (a Storage fileId).
// key is the IAM user id, so the preference follows the account across
// devices. Kept out of deleteAllDomain: a demo reset preserves identity.
// ---------------------------------------------------------------------------
export async function getUserAvatarFileId(userId: string): Promise<string | undefined> {
  const records = await listRecords("UserPreference");
  const record = records.find((entry) => asString(entry.key) === userId && asString(entry.avatarFileId));
  return record ? asString(record.avatarFileId) : undefined;
}

/** Point the user's avatar at a Storage fileId (relist-and-update-all, per the duplicate-safe pattern). */
export async function setUserAvatarFileId(userId: string, avatarFileId: string): Promise<void> {
  const records = await listRecords("UserPreference");
  const payload: DataRecord = { key: userId, avatarFileId, updatedAt: iso(Date.now()) };
  const ids = records
    .filter((record) => asString(record.key) === userId)
    .map(recordItemId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    assertGateway(await collections.UserPreference.create(payload), "Insert UserPreference");
    return;
  }
  for (const itemId of ids) {
    assertGateway(await collections.UserPreference.update(itemId, payload), "Update UserPreference");
  }
}

/** Remove the avatar preference (the Storage file itself is left in place). */
export async function clearUserAvatar(userId: string): Promise<void> {
  const records = await listRecords("UserPreference");
  const ids = records
    .filter((record) => asString(record.key) === userId)
    .map(recordItemId)
    .filter((id): id is string => Boolean(id));
  for (const itemId of ids) {
    assertGateway(await collections.UserPreference.delete(itemId, { hardDelete: true }), "Delete UserPreference");
  }
}
