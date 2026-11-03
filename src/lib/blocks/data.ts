// Blocks Data Gateway persistence for the TestPilot domain records. The four
// schemas live under blocks/data/schemas and are pushed with the Blocks CLI;
// every runtime call here goes through the shared SDK client (never a raw
// fetch). Gateway records are flat field bags identified by ItemId, so each
// app record carries its logical id in the `key` field and this module keeps
// key -> ItemId registries for updates. Timestamps are DateTime fields
// (ISO strings) -- GraphQL Int is 32-bit, so raw epoch milliseconds would
// overflow. Case-level results are never persisted; they derive from the run
// id (see ../demo/data.ts).
import { blocksClient } from "./client";
import {
  buildIssues,
  buildRunHistory,
  SEED_PROJECTS,
  SEED_SUITES,
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
type SchemaName = "Project" | "Suite" | "Run" | "Issue" | "UserPreference";

// Domain schemas wiped by deleteAllDomain. UserPreference is deliberately
// excluded: a demo-data reset must not clear the signed-in user's avatar.
const SCHEMAS: SchemaName[] = ["Project", "Suite", "Run", "Issue"];

// Must match the pushed schemas exactly. System fields (ItemId, CreatedDate,
// CreatedBy, ...) are managed by the gateway and never listed here.
const FIELDS: Record<SchemaName, string[]> = {
  Project: ["key", "name", "description", "icon", "tagsJson", "createdAt"],
  Suite: ["key", "projectId", "name", "description", "status", "owner", "lastUpdatedAt"],
  Run: ["key", "name", "projectId", "suiteId", "environment", "status", "total", "passed", "failed", "durationSec", "startedAt", "triggeredBy", "browser", "progress"],
  Issue: ["key", "title", "projectId", "runId", "severity", "status", "message", "stepsJson", "assignee", "createdAt", "updatedAt", "historyJson"],
  UserPreference: ["key", "avatarFileId", "updatedAt"]
};

// Gateway query names pluralize the schema name (Project -> getProjects).
const queryName = (schema: SchemaName) => `${schema}s`;

function domainCollection(schema: SchemaName) {
  return blocksClient.data.collection<DataRecord>(schema, { fields: [...FIELDS[schema]] });
}

const collections: Record<SchemaName, ReturnType<typeof domainCollection>> = {
  Project: domainCollection("Project"),
  Suite: domainCollection("Suite"),
  Run: domainCollection("Run"),
  Issue: domainCollection("Issue"),
  UserPreference: domainCollection("UserPreference")
};

// Logical id (`key`) -> gateway ItemId, filled on every full load and on
// creates, so later patches can address the right record.
const itemIds: Record<SchemaName, Map<string, string>> = {
  Project: new Map(),
  Suite: new Map(),
  Run: new Map(),
  Issue: new Map(),
  UserPreference: new Map()
};

const SEED_CHUNK = 50;
const CREATE_BATCH = 5;
const DELETE_CHUNK = 10;
// Conservative page size: the SDK defaults to 20 and no documented cap
// exists, so stay near what the skill examples use instead of assuming a
// large one is allowed.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

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
  return {
    key: project.id,
    name: project.name,
    description: project.description,
    icon: project.icon,
    tagsJson: JSON.stringify(project.tags),
    createdAt: iso(project.createdAt)
  };
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
  return {
    key: suite.id,
    projectId: suite.projectId,
    name: suite.name,
    description: suite.description,
    status: suite.status,
    owner: suite.owner,
    lastUpdatedAt: iso(suite.lastUpdatedAt)
  };
}

function fromRunRecord(record: DataRecord): Run {
  const progress = record.progress;
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
    progress: typeof progress === "number" && Number.isFinite(progress) ? progress : undefined
  };
}

function toRunRecord(run: Run): DataRecord {
  return {
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
  };
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
  return {
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
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
async function listRecords(schema: SchemaName): Promise<DataRecord[]> {
  const all: DataRecord[] = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const response = await collections[schema].list({ pageNo, pageSize: PAGE_SIZE });
    // The gateway nests results under the operation name (getProjects), not
    // the bare plural -- looking up "Projects" read [] out of a full response,
    // which made every load see an empty tenant, reseed and render zero rows.
    const items = itemsOf(assertGateway(response, `List ${schema}`), `get${queryName(schema)}`);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * List every record, paging past the app's display cap until a short page
 * says the collection is exhausted. Cleanup paths need this: a collection
 * larger than MAX_PAGES * PAGE_SIZE hides matches from the capped read, and
 * records beyond it would silently survive a delete.
 */
async function listAllRecords(schema: SchemaName): Promise<DataRecord[]> {
  const all: DataRecord[] = [];
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const response = await collections[schema].list({ pageNo, pageSize: PAGE_SIZE });
    const items = itemsOf(assertGateway(response, `List ${schema}`), `get${queryName(schema)}`);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

export type DomainSnapshot = { projects: Project[]; suites: Suite[]; runs: Run[]; issues: Issue[] };

async function listDomain(): Promise<DomainSnapshot> {
  const [projectRecords, suiteRecords, runRecords, issueRecords] = await Promise.all([
    listRecords("Project"),
    listRecords("Suite"),
    listRecords("Run"),
    listRecords("Issue")
  ]);
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
 * Full load used by the app store: lists all four collections and seeds an
 * empty tenant (first run on a fresh Blocks project) from the deterministic
 * seed generators before listing again.
 */
export async function loadDomain(): Promise<DomainSnapshot> {
  let snapshot = await listDomain();
  if (snapshot.projects.length === 0) {
    await seedDomain();
    snapshot = await listDomain();
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Seeding -- one-time population of an empty tenant. Bulk insertMany first,
// per-record creates as the fallback if the gateway rejects the bulk DSL.
// ---------------------------------------------------------------------------
async function seedDomain(): Promise<void> {
  const runs = buildRunHistory();
  const issues = buildIssues(runs);
  await insertMany("Project", SEED_PROJECTS.map(toProjectRecord));
  await insertMany("Suite", SEED_SUITES.map(toSuiteRecord));
  await insertMany("Run", runs.map(toRunRecord));
  await insertMany("Issue", issues.map(toIssueRecord));
}

async function insertMany(schema: SchemaName, records: DataRecord[]): Promise<void> {
  const mutation = `insertMany${schema}`;
  for (let offset = 0; offset < records.length; offset += SEED_CHUNK) {
    const chunk = records.slice(offset, offset + SEED_CHUNK);
    try {
      // BulkActionResponse has no itemId (verified against the live gateway:
      // it rejected exactly that field); acknowledged + totalImpactedData only.
      const data = assertGateway(await blocksClient.data.graphql({
        operationName: mutation,
        query: `mutation ${mutation}($input: [${schema}InsertInput!]!) { ${mutation}(input: $input) { acknowledged totalImpactedData } }`,
        variables: { input: chunk }
      }), `Bulk insert ${schema}`);
      const result = data[mutation] as { acknowledged?: unknown } | null | undefined;
      if (!result || result.acknowledged === false) {
        throw new Error(`${mutation} was not acknowledged`);
      }
    } catch (bulkError) {
      // Unknown bulk DSL or a gateway rejection -- per-record creates are the
      // documented path and each one is asserted individually, so a payload
      // the schema rejects surfaces here instead of vanishing. The bulk
      // rejection itself is logged: a silently-swallowed failure here is
      // exactly what made the original seeding undebuggable.
      console.warn(`[TestPilot] Bulk insert ${schema} rejected, falling back to per-record creates:`, bulkError);
      await createRecords(schema, chunk);
    }
  }
}

async function createRecords(schema: SchemaName, records: DataRecord[]): Promise<void> {
  for (let offset = 0; offset < records.length; offset += CREATE_BATCH) {
    await Promise.all(records.slice(offset, offset + CREATE_BATCH).map((record) =>
      assertGateway(collections[schema].create(record), `Insert ${schema}`)
    ));
  }
}

// ---------------------------------------------------------------------------
// Writes -- called fire-and-forget by the store: a failed cloud write must
// never break the UI; the record re-syncs on the next full load. The store
// still logs the rejection, so the reason stays visible in the console.
// ---------------------------------------------------------------------------
async function patchRecord(schema: SchemaName, key: string, record: DataRecord): Promise<void> {
  const itemId = itemIds[schema].get(key);
  if (!itemId) return;
  assertGateway(await collections[schema].update(itemId, record), `Update ${schema}`);
}

export async function createRunRecord(run: Run): Promise<void> {
  const data = assertGateway(await collections.Run.create(toRunRecord(run)), "Insert Run");
  const result = data.insertRun as { itemId?: unknown } | null | undefined;
  const itemId = typeof result?.itemId === "string" && result.itemId ? result.itemId : undefined;
  if (itemId) itemIds.Run.set(run.id, itemId);
}

export function updateRunRecord(run: Run): Promise<void> {
  return patchRecord("Run", run.id, toRunRecord(run));
}

export function updateIssueRecord(issue: Issue): Promise<void> {
  return patchRecord("Issue", issue.id, toIssueRecord(issue));
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
    .filter((record) => asString(record.key) === project.id)
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
async function deleteManyMatching(schema: SchemaName, where: DataRecord): Promise<number> {
  const mutation = `deleteMany${schema}`;
  const data = assertGateway(await blocksClient.data.graphql({
    operationName: mutation,
    query: `mutation ${mutation}($where: ${schema}FilterInput, $input: ${schema}DeleteInput) { ${mutation}(where: $where, input: $input) { acknowledged totalImpactedData } }`,
    // RunDeleteInput.isHardDelete (introspected) -- the flag is REQUIRED on
    // the bulk input, and it is spelled isHardDelete, not hardDelete.
    variables: { where, input: { isHardDelete: true } }
  }), `Bulk delete ${schema}`);
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
  for (const schema of ["Suite", "Run", "Issue"] as SchemaName[]) {
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

/** Settings > Danger zone: wipe every domain record so a fresh seed starts. */
export async function deleteAllDomain(): Promise<void> {
  for (const schema of SCHEMAS) {
    // List-and-delete in passes: listRecords reads at most
    // MAX_PAGES * PAGE_SIZE items, so one pass only reaches the first slice
    // of a collection larger than that (the duplicated-seed tenant had
    // thousands of runs) -- repeat until the list comes back empty.
    try {
      for (let pass = 0; pass < 50; pass++) {
        const records = await listRecords(schema);
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
