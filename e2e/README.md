# TestPilot AI — E2E (Playwright)

End-to-end suite for the deployed TestPilot AI app. One spec file per sidebar
menu, all following the same `describe > test > test.step` shape, with the UI
wrapped in page objects (`pages/`).

## Layout

```
e2e/
  playwright.config.ts    # mirrors the runner's generated "repo-shaped" config:
                          # projects setup → data-setup → data → data-teardown
  lib/config.ts           # reads e2e/.env / process env (cwd-relative, CJS-safe)
  pages/                  # page object model — one class per menu + shell/auth
  tests/
    suite/
      suite.setup.spec.ts # hosted IAM login → overwrites fixtures/data-session.json
    fixtures.ts           # shared test fixture (aborts localhost:9090 chatter)
    <menu>.spec.ts        # overview / projects / runs / suites / issues /
                          # reports / users / roles / organizations / settings / help
  fixtures/
    data-session.json     # local-only (git-ignored) — written by data-setup;
                          # config omits storageState when it's absent
  artifacts/              # test-results + html report (generated, ignored)
```

Every menu file holds exactly **one test block** (`describe > test`), and every
action inside it is a named `test.step` — so each file runs and reports as a
single test.

**Why this shape:** the TestPilot runner ignores a workspace's own
`playwright.config.*` and always generates its own — a "repo-shaped" mirror
(the same four projects, same matchers, `workers: 1`, storageState from
`fixtures/data-session.json`) for any suite whose specs all live under
`tests/`. Keeping this repo's real config identical means a run through the
app's workbench behaves exactly like a terminal run. The data project's
storageState only needs the file to EXIST at startup; `suite.setup` refreshes
it before any menu test creates its context, so every menu test reads the
current run's fresh session. If a menu test ever finds a dead session anyway,
`BasePage.ensureShell()` recovers by re-running the hosted login itself.

## Setup

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

Headless by default:

```bash
npm test          # data-setup login + all menu suites
npm run test:headed
npm run test:ui
npm run report    # open the last HTML report
```

Filter a single menu: `npx playwright test tests/users.spec.ts`

**Run through the TestPilot app:** open the `e2e` folder in the workbench and
press Run — the runner picks every spec under `tests/`, reads `.env*` from
this folder for `E2E_BASE_URL`/credentials, and executes the same graph.
Terminal and in-app runs produce the same results.

## Configuration

`e2e/.env` (git-ignored) or real environment variables:

| Variable       | Default                          |
| -------------- | -------------------------------- |
| `E2E_BASE_URL` | `https://dbycry-erkzk.slsblx.com`|
| `E2E_EMAIL`    | — (required for login)           |
| `E2E_PASSWORD` | — (required for login)           |

## Notes

- Tests are **read-only smoke checks**: they never create, edit or delete
  workspace data (no New project / Invite / Delete / Save clicks).
- Assertions accept both empty states and populated lists, so they hold
  whether or not the tenant currently has projects/runs/issues.
- UI strings are matched in English (the app's default language).
- `artifacts/` and `.auth/` are generated — `e2e/.gitignore` excludes them.
  `fixtures/data-session.json` is ignored too: it holds a live session after
  every run, so it never ships. The config's `fs.existsSync` guard omits the
  storageState on a fresh checkout; a signed-out menu test then recovers
  through `BasePage.ensureShell()`'s hosted re-login, and the first
  `data-setup` run writes the file locally again.
