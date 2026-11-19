# TestPilot AI — Playwright bootstrap

You are being asked to make **this repository** runnable through **TestPilot AI**
(https://dbycry-erkzk.slsblx.com) — the app that opens a repo folder as a suite
and runs its Playwright specs. Follow this document exactly. Two paths apply:

- **Path A** — the repo has no Playwright suite yet: scaffold one in the
  expected shape.
- **Path B** — the repo already has a Playwright suite in some other layout or
  style: conform it **consciously** to the expected shape without breaking what
  works.

Before touching anything in Path B, inventory what exists (configs, helpers,
fixtures, spec layout) and tell the user what will move and what will change.

---

## 1. What the TestPilot runner expects

The runner mirrors this repository's own `e2e/` shape (see
`e2e/playwright.config.ts` and the runner's `buildConfig()` — when this file
and the runner disagree, the runner wins):

- **All specs live under a `tests/` folder** at the workspace root. That single
  layout unlocks the project graph below; any other layout falls back to one
  flat default project.
- **The runner ignores your `playwright.config.*` and `package.json`** — it
  generates its own config and pins `{ "type": "commonjs" }`. Keep your local
  config for `npm test` parity if you like, but the run inside TestPilot never
  reads it.
- **Project graph** (repo shape):
  | Project | Matches | Purpose |
  | --- | --- | --- |
  | `setup` | `tests/auth/login.spec.ts` | login smoke, no storage state |
  | `data-setup` | `tests/suite.setup.spec.ts` | signs in once, writes `fixtures/data-session.json` |
  | `data` | every other `tests/**/*.spec.ts` | the real suites — run with `fixtures/data-session.json` as `storageState` when present |
  | `data-teardown` | `tests/suite.teardown.spec.ts` | optional cleanup, runs last |
- **Sequential by design**: `workers: 1`, `fullyParallel: false`, `retries: 0`,
  `timeout: 120000`. Never write tests that depend on parallelism or retries.
- **CommonJS pinned**: `import.meta` throws — strip it from specs and helpers.
  Playwright's own transpile pipeline handles `import` syntax; extensionless
  relative helper imports (`../../support/test-base`) work.
- **cwd-relative paths only** — the run executes from the workspace root inside
  a temp project, so absolute machine paths never resolve.
- **Environment comes from workspace-root `.env*` files** (dotenv-style):
  `E2E_BASE_URL` selects the app under test; credentials such as
  `E2E_EMAIL` / `E2E_PASSWORD` ride along to the browser process. Never
  hardcode secrets in specs; never read token/config files directly.
- **Carried folders**: `tests`, `pages`, `support`, `helpers`, `fixtures`,
  `components`, `specs`, `spec`, `test`, `e2e`, `playwright` are copied into
  the run (plus binary fixtures, capped at 400 files / 25 MB each).
  `node_modules`, `.git`, `test-results`, `playwright-report` are never
  carried, and **dependencies are not installed** — stick to `@playwright/test`
  APIs; do not import npm packages the runner cannot resolve.

## 2. Test-authoring conventions (this app's format)

- **One spec file per menu or feature.** Each file holds **exactly one**
  `test.describe > test` block; every action inside is a named `test.step`.
  A file reads and reports as a single test.
- **Page Object Model**: page classes under `pages/` extending a shared
  `BasePage`; role-based locators (`getByRole`); English UI strings.
- **Read-only smoke assertions**: never create, edit or delete data in the
  app under test. Assertions must hold whether the workspace is **empty or
  populated** — accept either the list or the empty state
  (`expect(row.or(emptyState).first()).toBeVisible()`).
- **Wait for real content**, not fixed sleeps: app shells render a skeleton
  until data loads, and a storageState context may silently bounce through
  hosted login on first load — wait for the shell or the login card, then
  proceed (retry the navigation once if the shell vanishes mid-click).
- The `data` project starts **already signed in** via the storage state —
  do not log in again per spec.

## 3. Path A — scaffold a new suite

Create exactly this skeleton (adjust names to the app under test):

```
.env                              # E2E_BASE_URL=..., E2E_EMAIL=..., E2E_PASSWORD=...
tests/
  auth/login.spec.ts              # smoke: unauthenticated gate renders
  suite.setup.spec.ts             # one-time UI sign-in → fixtures/data-session.json
  <menu-1>.spec.ts                # one file per menu, single test, test.step
  <menu-2>.spec.ts
fixtures/                         # data-session.json lands here at runtime
pages/                            # page objects (BasePage + one per menu)
support/                          # shared helpers (config reader, shell waiter)
```

`tests/suite.setup.spec.ts` must authenticate through the app's real flow and
persist Playwright's storage state:

```ts
import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("sign in once and persist the session", async ({ page }) => {
  await test.step("open the login screen", async () => { /* ... */ });
  await test.step("submit credentials from the environment", async () => {
    // process.env.E2E_EMAIL / process.env.E2E_PASSWORD — never hardcoded
  });
  await test.step("save fixtures/data-session.json", async () => {
    fs.mkdirSync("fixtures", { recursive: true });
    await page.context().storageState({ path: "fixtures/data-session.json" });
  });
});
```

## 4. Path B — conform an existing suite

1. **Inventory first**: list existing configs, global setups, helpers, fixture
   files and specs; note which are ESM-only (`import.meta`), which hardcode
   absolute paths or secrets, and which specs log in per-file.
2. **Move specs under `tests/`** (keep subfolders: `tests/auth/…`,
   `tests/menu-x.spec.ts`). One shared-login spec becomes
   `tests/suite.setup.spec.ts` writing `fixtures/data-session.json`; delete
   per-spec login steps — the `data` project already carries the session.
3. **Keep the page objects and helpers** — place them in `pages/` / `support/`,
   strip `import.meta` and ESM-only Node APIs, and make every path
   cwd-relative.
4. **Restyle to the format**: one file per menu, one `test.describe > test` per
   file, actions wrapped in `test.step`; split oversized files by menu rather
   than merging everything into one.
5. **Make assertions read-only and state-tolerant** (empty or populated), and
   move destructive flows out of the default run.
6. **Local parity**: keep the repo's own `playwright.config.ts` mirroring the
   same project graph and env names for plain `npm test` runs — the runner
   ignores it, so the two never fight.

## 5. Verify

Tell the user to open the folder in TestPilot AI (Projects → project →
Playwright Editor tab → open folder → Test suites / Run) and run it. Confirm
the run executes through the project graph (setup → data-setup → data →
data-teardown) and every menu file reports as a single test. Report anything
that could not be verified instead of smoothing it over.
