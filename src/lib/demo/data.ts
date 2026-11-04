// Domain dataset for TestPilot AI. Blocks has no native test-management API,
// so the domain records (projects, suites, runs, issues) are persisted in the
// Blocks Data Gateway -- see ../blocks/data.ts and the schemas under
// blocks/data/schemas. This module holds the app-facing types, the
// deterministic seed generators that populate an empty tenant on first load,
// and the aggregators derived on demand from the run list. Case-level results
// are never stored anywhere: they derive from the run id so detail pages stay
// deterministic without holding thousands of rows.

import type { TranslationKey } from "../i18n/dictionary";

export type ProjectIcon = "globe" | "cart" | "phone" | "megaphone" | "receipt";

export type Project = {
  id: string;
  name: string;
  description: string;
  icon: ProjectIcon;
  tags: string[];
  createdAt: number;
};

export type SuiteStatus = "active" | "draft" | "archived";

export type Suite = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: SuiteStatus;
  owner: string;
  lastUpdatedAt: number;
};

export type RunStatus = "passed" | "failed" | "running" | "pending" | "cancelled";
export type Environment = "production" | "staging" | "sandbox";

export type Run = {
  id: string;
  name: string;
  projectId: string;
  suiteId: string;
  environment: Environment;
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  durationSec: number;
  startedAt: number;
  triggeredBy: string;
  browser: "chromium" | "webkit" | "firefox";
  /** 0-100, only meaningful while status is "running". */
  progress?: number;
};

export type CaseStatus = "passed" | "failed" | "skipped";

export type CaseResult = {
  id: string;
  name: string;
  status: CaseStatus;
  durationMs: number;
  error?: string;
  /** Present on runner-backed cases (store.runPlaywrightTests); absent on simulated ones. */
  runId?: string;
  order?: number;
};

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus = "open" | "in_progress" | "resolved";

export type IssueEvent = { at: number; actor: string; labelKey: TranslationKey };

export type Issue = {
  id: string;
  title: string;
  projectId: string;
  runId?: string;
  severity: IssueSeverity;
  status: IssueStatus;
  message: string;
  steps: string[];
  assignee: string;
  createdAt: number;
  updatedAt: number;
  history: IssueEvent[];
};

export type DayActivity = { dayStart: number; label: string; passed: number; failed: number };

// ---------------------------------------------------------------------------
// Seeded randomness -- mulberry32. Deterministic so the demo never shifts
// under the viewer between reloads.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function shortDayLabel(dayStart: number): string {
  return new Date(dayStart).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const PEOPLE = ["Maya Lindqvist", "Tomas Rivera", "Priya Nair", "Jonas Weber", "Amara Osei", "Liu Wei"] as const;
const BROWSERS: Run["browser"][] = ["chromium", "webkit", "firefox"];

// ---------------------------------------------------------------------------
// Catalogs. The seed definitions below generate the initial cloud records on
// first load; the exported arrays are the LIVE catalogs -- cloud.ts empties
// and refills them in place every time it loads from the Data Gateway, so
// imported references stay valid across reloads. Read them only from render
// paths that re-run when the store emits (see useDemoState).
// ---------------------------------------------------------------------------
export const SEED_PROJECTS: Project[] = [
  {
    id: "proj-web",
    name: "Storefront Web App",
    description: "End-to-end coverage for the customer-facing storefront: catalog, cart, checkout and account flows.",
    icon: "globe",
    tags: ["e2e", "playwright", "critical path"],
    createdAt: Date.now() - 460 * DAY_MS
  },
  {
    id: "proj-api",
    name: "Checkout API",
    description: "Contract and integration tests for pricing, taxes, payment intents and order placement.",
    icon: "cart",
    tags: ["api", "contract", "payments"],
    createdAt: Date.now() - 380 * DAY_MS
  },
  {
    id: "proj-mobile",
    name: "Mobile App Backend",
    description: "Device-profile regression for sessions, sync and push pipelines behind the mobile clients.",
    icon: "phone",
    tags: ["regression", "device profiles"],
    createdAt: Date.now() - 300 * DAY_MS
  },
  {
    id: "proj-mkt",
    name: "Marketing Site",
    description: "Smoke and visual checks for campaign landing pages, forms and the public pricing area.",
    icon: "megaphone",
    tags: ["smoke", "visual"],
    createdAt: Date.now() - 210 * DAY_MS
  },
  {
    id: "proj-billing",
    name: "Billing Platform",
    description: "Invoice generation, plan changes, dunning and the usage metering pipeline.",
    icon: "receipt",
    tags: ["billing", "usage", "sox"],
    createdAt: Date.now() - 150 * DAY_MS
  }
];

export const projects: Project[] = [];

export const SEED_SUITES: Suite[] = [
  { id: "suite-web-checkout", projectId: "proj-web", name: "Checkout journey", description: "Guest and signed-in checkout across payment methods.", status: "active", owner: "Maya Lindqvist", lastUpdatedAt: Date.now() - 2 * DAY_MS },
  { id: "suite-web-auth", projectId: "proj-web", name: "Authentication & account", description: "Login, SSO, password reset and profile updates.", status: "active", owner: "Priya Nair", lastUpdatedAt: Date.now() - 1 * DAY_MS },
  { id: "suite-web-catalog", projectId: "proj-web", name: "Catalog & search", description: "Listing pages, facets, filters and product detail.", status: "active", owner: "Tomas Rivera", lastUpdatedAt: Date.now() - 5 * DAY_MS },
  { id: "suite-web-legacy", projectId: "proj-web", name: "Legacy cart (v1)", description: "Retired v1 cart flows kept for the migration window.", status: "archived", owner: "Jonas Weber", lastUpdatedAt: Date.now() - 40 * DAY_MS },
  { id: "suite-api-pricing", projectId: "proj-api", name: "Pricing & taxes", description: "Price calculation, tax rules and currency rounding.", status: "active", owner: "Liu Wei", lastUpdatedAt: Date.now() - 1 * DAY_MS },
  { id: "suite-api-orders", projectId: "proj-api", name: "Order placement", description: "Order lifecycle: intent, capture, fulfillment events.", status: "active", owner: "Amara Osei", lastUpdatedAt: Date.now() - 3 * DAY_MS },
  { id: "suite-api-promos", projectId: "proj-api", name: "Promotions engine", description: "Coupon stacking, exclusions and campaign windows.", status: "draft", owner: "Tomas Rivera", lastUpdatedAt: Date.now() - 8 * DAY_MS },
  { id: "suite-mobile-sync", projectId: "proj-mobile", name: "Sync & offline", description: "Background sync, conflict resolution and retries.", status: "active", owner: "Jonas Weber", lastUpdatedAt: Date.now() - 2 * DAY_MS },
  { id: "suite-mobile-push", projectId: "proj-mobile", name: "Push notifications", description: "Token rotation, delivery receipts, deep links.", status: "active", owner: "Priya Nair", lastUpdatedAt: Date.now() - 6 * DAY_MS },
  { id: "suite-mkt-smoke", projectId: "proj-mkt", name: "Campaign smoke", description: "Fast pass over live campaign pages and lead forms.", status: "active", owner: "Amara Osei", lastUpdatedAt: Date.now() - 1 * DAY_MS },
  { id: "suite-mkt-visual", projectId: "proj-mkt", name: "Visual regression", description: "Screenshot diffs on templates and pricing tables.", status: "draft", owner: "Maya Lindqvist", lastUpdatedAt: Date.now() - 12 * DAY_MS },
  { id: "suite-billing-invoices", projectId: "proj-billing", name: "Invoice generation", description: "PDF layout, line items, credit notes and totals.", status: "active", owner: "Liu Wei", lastUpdatedAt: Date.now() - 4 * DAY_MS },
  { id: "suite-billing-plans", projectId: "proj-billing", name: "Plan changes & dunning", description: "Upgrades, downgrades, retries and grace periods.", status: "active", owner: "Jonas Weber", lastUpdatedAt: Date.now() - 2 * DAY_MS },
  { id: "suite-billing-migration", projectId: "proj-billing", name: "Ledger migration checks", description: "One-off parity checks from the 2025 ledger migration.", status: "archived", owner: "Amara Osei", lastUpdatedAt: Date.now() - 55 * DAY_MS }
];

export const suites: Suite[] = [];

export function suitesForProject(projectId: string): Suite[] {
  return suites.filter((suite) => suite.projectId === projectId && suite.status === "active");
}

// Seed generation must not depend on the live catalogs (they are empty until
// the gateway load completes), so it reads the seed definitions directly.
function seedSuitesForProject(projectId: string): Suite[] {
  return SEED_SUITES.filter((suite) => suite.projectId === projectId && suite.status === "active");
}

export function suiteById(id: string): Suite | undefined {
  return suites.find((suite) => suite.id === id);
}

export function projectById(id: string): Project | undefined {
  return projects.find((project) => project.id === id);
}

// ---------------------------------------------------------------------------
// Run history: 60 days, seeded. Today deliberately contains a pending and a
// running run so live states are visible in the UI.
// ---------------------------------------------------------------------------
const WEIGHTED_PROJECTS: [string, number][] = [
  ["proj-web", 0.28],
  ["proj-api", 0.22],
  ["proj-mobile", 0.18],
  ["proj-mkt", 0.17],
  ["proj-billing", 0.15]
];

function pickWeightedProject(random: number): string {
  let acc = 0;
  for (const [id, weight] of WEIGHTED_PROJECTS) {
    acc += weight;
    if (random < acc) return id;
  }
  return "proj-web";
}

function pickEnvironment(random: number): Environment {
  if (random < 0.52) return "staging";
  if (random < 0.84) return "production";
  return "sandbox";
}

export function buildRunHistory(): Run[] {
  const random = mulberry32(20261102);
  const runs: Run[] = [];
  const today = startOfDay(Date.now());
  let sequence = 1;

  for (let dayOffset = 59; dayOffset >= 0; dayOffset--) {
    const dayStart = today - dayOffset * DAY_MS;
    const weekday = new Date(dayStart).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const runCount = (isWeekend ? 1 : 2) + Math.floor(random() * (isWeekend ? 2 : 3));

    for (let i = 0; i < runCount; i++) {
      const projectId = pickWeightedProject(random());
      const projectSuites = seedSuitesForProject(projectId);
      const suite = projectSuites[Math.floor(random() * projectSuites.length)]!;
      const environment = pickEnvironment(random());
      const total = 8 + Math.floor(random() * 34);
      const startedAt = dayStart + (8 + Math.floor(random() * 11)) * 3_600_000 + Math.floor(random() * 3_600_000);
      const roll = random();

      let status: RunStatus;
      if (dayOffset === 0 && i === 0) status = "running";
      else if (dayOffset === 0 && i === 1) status = "pending";
      else if (roll < 0.845) status = "passed";
      else if (roll < 0.955) status = "failed";
      else if (roll < 0.975) status = "cancelled";
      else status = "passed";

      const failed = status === "failed" ? 1 + Math.floor(random() * Math.max(1, Math.floor(total * 0.25))) : 0;
      const passed = status === "passed" ? total : Math.max(0, total - failed);
      const durationSec = Math.round(total * (10 + random() * 9) * (status === "failed" ? 1.2 : 1));

      runs.push({
        id: `run-${String(sequence).padStart(3, "0")}`,
        name: `${suite.name} · ${environment}`,
        projectId,
        suiteId: suite.id,
        environment,
        status,
        total,
        passed,
        failed,
        durationSec: status === "pending" ? 0 : durationSec,
        startedAt: status === "pending" ? Date.now() + 25 * 60_000 : startedAt,
        triggeredBy: PEOPLE[Math.floor(random() * PEOPLE.length)]!,
        browser: BROWSERS[Math.floor(random() * BROWSERS.length)]!,
        progress: status === "running" ? 42 : undefined
      });
      sequence++;
    }
  }

  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

// ---------------------------------------------------------------------------
// Case-level results, generated per run on demand (seeded by run id) so run
// detail pages stay deterministic without holding thousands of rows in state.
// ---------------------------------------------------------------------------
const CASE_FEATURES: Record<string, string[]> = {
  "proj-web": ["guest checkout completes", "paypal redirect round-trip", "saved address autofill", "promo code applies once", "order confirmation email queued", "cart persists across sessions", "product image zoom loads", "size guide modal focus trap", "search facets stay in sync", "wishlist merge on login", "password reset link expires", "SSO redirect preserves basket"],
  "proj-api": ["price calculation rounds correctly", "tax rules by region", "payment intent capture", "idempotent order creation", "webhook signature verified", "coupon exclusion enforced", "currency conversion fallback", "order events published in order"],
  "proj-mobile": ["background sync resumes", "conflict resolution keeps newest", "push token rotates", "deep link opens order", "offline queue flushes", "session refresh on 401"],
  "proj-mkt": ["campaign page renders", "lead form submits", "pricing table matches plans", "hero image optimized", "meta tags present", "locale switch keeps page"],
  "proj-billing": ["invoice PDF totals match", "credit note applied", "plan proration correct", "dunning email on failure", "usage meter aggregation", "grace period honored"]
};

const ERROR_MESSAGES = [
  "TimeoutError: locator.waitFor: Timeout 30000ms exceeded waiting for selector '[data-testid=\"order-confirm\"]'",
  "AssertionError: expected response status 201 but received 502 from payment-gateway",
  "expect(received).toEqual(expected) // deep equality failed on totals.lineItems[3].taxAmount",
  "Error: Navigation failed because page crashed (segmentation while rendering checkout iframe)",
  "TimeoutError: apiRequestContext.post: Request timed out after 20000ms on /v2/orders",
  "AssertionError: screenshot diff 4.2% exceeds threshold 1% on pricing-table region",
  "Error: push receipt not delivered within 15000ms window",
  "expect(received).toBeVisible() // element '[data-testid=\"invoice-download\"]' hidden after retry x3"
];

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Second-and-later passes over the feature list get one of these qualifiers
// so case names stay unique inside a single run.
const CASE_VARIANTS = ["critical path", "smoke pass", "regression pass", "retry after failure", "slow network", "mobile viewport"];

export function buildRunCases(run: Run): CaseResult[] {
  const random = mulberry32(hashSeed(run.id));
  const suite = suiteById(run.suiteId);
  const features = (CASE_FEATURES[run.projectId] ?? CASE_FEATURES["proj-web"])!;
  // Seeded shuffle: each run walks the feature list in its own order, so the
  // first pass never repeats a feature.
  const order = features.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const cases: CaseResult[] = [];
  const failureBudget = run.status === "failed" ? run.failed : 0;

  const count = Math.min(run.total, 24);
  for (let i = 0; i < count; i++) {
    const featureIndex = order[i % order.length]!;
    const feature = features[featureIndex]!;
    const pass = Math.floor(i / order.length);
    const variant = pass === 0 ? "" : ` (${CASE_VARIANTS[(pass - 1 + featureIndex) % CASE_VARIANTS.length]!})`;
    const isFailed = i < failureBudget;
    const isSkipped = !isFailed && run.status !== "passed" && random() < 0.04;
    cases.push({
      id: `${run.id}-case-${i + 1}`,
      name: `${suite?.name.toLowerCase() ?? "suite"} › ${feature}${variant}`,
      status: isFailed ? "failed" : isSkipped ? "skipped" : "passed",
      durationMs: Math.round(400 + random() * 9_000),
      error: isFailed ? ERROR_MESSAGES[(hashSeed(run.id) + i) % ERROR_MESSAGES.length]! : undefined
    });
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Issues: derived from failed runs so the two surfaces stay consistent.
// ---------------------------------------------------------------------------
const ISSUE_TITLES: Record<string, string[]> = {
  "proj-web": [
    "3-D Secure challenge stalls the checkout confirmation step",
    "PayPal redirect drops the basket when returning to /checkout",
    "Order confirmation email not queued for guest checkouts",
    "Saved address autofill fills the deprecated region field"
  ],
  "proj-api": [
    "Payment gateway returns 502 on high-value intents",
    "Tax amount mismatch for line items with mixed VAT rates",
    "Webhook signature check rejects rotated secrets",
    "Order events published out of order under load"
  ],
  "proj-mobile": [
    "Background sync never resumes after forced kill",
    "Push receipts missing for iOS 18 devices",
    "Deep link to order detail opens catalog instead"
  ],
  "proj-mkt": [
    "Campaign lead form rejects valid phone numbers",
    "Pricing table screenshot drift after template update",
    "Locale switch resets campaign landing to default"
  ],
  "proj-billing": [
    "Invoice PDF pagination splits credit notes mid-line",
    "Proration rounding off by one cent on downgrade",
    "Usage aggregation drops events older than 24h"
  ]
};

export function buildIssues(runs: Run[]): Issue[] {
  const random = mulberry32(777001);
  const failedRuns = runs.filter((run) => run.status === "failed").sort((a, b) => b.startedAt - a.startedAt);
  const issues: Issue[] = [];
  const perProject = new Map<string, number>();
  let sequence = 101;

  for (const run of failedRuns) {
    const open = perProject.get(run.projectId) ?? 0;
    if (open >= 4 || issues.length >= 14) continue;
    perProject.set(run.projectId, open + 1);

    const titles = ISSUE_TITLES[run.projectId] ?? ISSUE_TITLES["proj-web"]!;
    const title = titles[open % titles.length]!;
    const ratio = run.total > 0 ? run.failed / run.total : 0;
    const severity: IssueSeverity = ratio >= 0.2 ? "critical" : ratio >= 0.12 ? "high" : ratio >= 0.06 ? "medium" : "low";
    const ageDays = Math.max(0, Math.round((Date.now() - run.startedAt) / DAY_MS));
    const status: IssueStatus = ageDays > 21 ? "resolved" : ageDays > 7 ? "in_progress" : "open";
    const assignee = PEOPLE[Math.floor(random() * PEOPLE.length)]!;
    const createdAt = run.startedAt + 45 * 60_000;
    const history: IssueEvent[] = [
      { at: createdAt, actor: run.triggeredBy, labelKey: "issue.event.opened" },
      { at: createdAt + DAY_MS, actor: assignee, labelKey: "issue.event.triaged" }
    ];
    if (status !== "open") history.push({ at: createdAt + 2 * DAY_MS, actor: assignee, labelKey: "issue.event.started" });
    if (status === "resolved") history.push({ at: createdAt + 5 * DAY_MS, actor: assignee, labelKey: "issue.event.resolved" });

    issues.push({
      id: `ISS-${sequence++}`,
      title,
      projectId: run.projectId,
      runId: run.id,
      severity,
      status,
      message: buildRunCases({ ...run, status: "failed" }).find((entry) => entry.status === "failed")?.error ?? "Test failed with an unhandled error.",
      steps: [
        `Re-run ${run.name} on ${run.environment}`,
        "Open the failed case from the run detail",
        "Compare the trace against the last green run",
        "Confirm the failure reproduces locally against staging"
      ],
      assignee,
      createdAt,
      updatedAt: history[history.length - 1]!.at,
      history
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Aggregations derived on demand from the run list.
// ---------------------------------------------------------------------------
export type Kpis = {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  deltas: { total: number; passed: number; failed: number; rate: number };
};

export function completedRuns(runs: Run[]): Run[] {
  return runs.filter((run) => run.status === "passed" || run.status === "failed");
}

function windowTotals(runs: Run[], from: number, to: number) {
  let total = 0;
  let passed = 0;
  let failed = 0;
  for (const run of runs) {
    if (run.startedAt < from || run.startedAt >= to) continue;
    if (run.status !== "passed" && run.status !== "failed") continue;
    total += run.total;
    passed += run.passed;
    failed += run.failed;
  }
  return { total, passed, failed };
}

export function computeKpis(runs: Run[], days: number, now = Date.now()): Kpis {
  const todayEnd = startOfDay(now) + DAY_MS;
  const windowStart = todayEnd - days * DAY_MS;
  const prevStart = windowStart - days * DAY_MS;

  const current = windowTotals(runs, windowStart, todayEnd);
  const previous = windowTotals(runs, prevStart, windowStart);

  const rate = (entry: { passed: number; failed: number }) => (entry.passed + entry.failed > 0 ? (entry.passed / (entry.passed + entry.failed)) * 100 : 0);
  const pctChange = (nowValue: number, prevValue: number) => (prevValue > 0 ? ((nowValue - prevValue) / prevValue) * 100 : 0);

  return {
    totalTests: current.total,
    passedTests: current.passed,
    failedTests: current.failed,
    successRate: rate(current),
    deltas: {
      total: pctChange(current.total, previous.total),
      passed: pctChange(current.passed, previous.passed),
      failed: pctChange(current.failed, previous.failed),
      rate: rate(current) - rate(previous)
    }
  };
}

export function buildDailyActivity(runs: Run[], days: number, now = Date.now()): DayActivity[] {
  const today = startOfDay(now);
  const buckets = new Map<number, DayActivity>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const dayStart = today - offset * DAY_MS;
    buckets.set(dayStart, { dayStart, label: shortDayLabel(dayStart), passed: 0, failed: 0 });
  }
  for (const run of completedRuns(runs)) {
    const bucket = buckets.get(startOfDay(run.startedAt));
    if (!bucket) continue;
    bucket.passed += run.passed;
    bucket.failed += run.failed;
  }
  return [...buckets.values()];
}

export function buildDailyCounts(runs: Run[], days: number, now = Date.now()): { label: string; dayStart: number; value: number }[] {
  const today = startOfDay(now);
  const buckets = new Map<number, number>();
  const labels = new Map<number, string>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const dayStart = today - offset * DAY_MS;
    buckets.set(dayStart, 0);
    labels.set(dayStart, shortDayLabel(dayStart));
  }
  for (const run of completedRuns(runs)) {
    const dayStart = startOfDay(run.startedAt);
    if (buckets.has(dayStart)) buckets.set(dayStart, (buckets.get(dayStart) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([dayStart, value]) => ({ dayStart, label: labels.get(dayStart) ?? "", value }));
}

export function buildPassRateTrend(runs: Run[], days: number, now = Date.now()): { label: string; value: number }[] {
  return buildDailyActivity(runs, days, now)
    .filter((day) => day.passed + day.failed > 0)
    .map((day) => ({ label: day.label, value: (day.passed / (day.passed + day.failed)) * 100 }));
}

export type ProjectStat = {
  projectId: string;
  runs: number;
  totalTests: number;
  successRate: number;
  lastActivity: number;
};

export function buildProjectStats(runs: Run[], days: number, now = Date.now()): ProjectStat[] {
  const since = startOfDay(now) + DAY_MS - days * DAY_MS;
  return projects.map((project) => {
    const scoped = completedRuns(runs).filter((run) => run.projectId === project.id && run.startedAt >= since);
    const totalTests = scoped.reduce((sum, run) => sum + run.total, 0);
    const passedTests = scoped.reduce((sum, run) => sum + run.passed, 0);
    const failedTests = scoped.reduce((sum, run) => sum + run.failed, 0);
    const lastRun = scoped.reduce<Run | undefined>((latest, run) => (!latest || run.startedAt > latest.startedAt ? run : latest), undefined);
    return {
      projectId: project.id,
      runs: scoped.length,
      totalTests,
      successRate: passedTests + failedTests > 0 ? (passedTests / (passedTests + failedTests)) * 100 : 0,
      lastActivity: lastRun?.startedAt ?? project.createdAt
    };
  });
}

export type FailingTest = { name: string; count: number };

export function buildTopFailingTests(runs: Run[], limit = 6): FailingTest[] {
  const counts = new Map<string, number>();
  for (const run of completedRuns(runs)) {
    if (run.status !== "failed") continue;
    const cases = buildRunCases(run);
    for (const entry of cases) {
      if (entry.status !== "failed") continue;
      counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
