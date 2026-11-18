# TestPilot AI — E2E (Playwright)

End-to-end suite for the deployed TestPilot AI app. One spec file per sidebar
menu, all following the same `describe > test > test.step` shape, with the UI
wrapped in page objects (`pages/`).

## Layout

```
e2e/
  playwright.config.ts    # 2 projects: setup (login) → chromium (menus)
  lib/config.ts           # reads e2e/.env / process env
  pages/                  # page object model — one class per menu + shell/auth
  tests/
    auth.setup.ts         # hosted Blocks IAM login → .auth/user.json
    fixtures.ts           # shared test fixture (aborts localhost:9090 chatter)
    <menu>.spec.ts        # overview / projects / runs / suites / issues /
                          # reports / users / roles / organizations / settings / help
  artifacts/              # test-results + html report (generated)
```

Every menu file holds exactly **one test block** (`describe > test`), and every
action inside it is a named `test.step` — so each file runs and reports as a
single test.

## Setup

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

Headless by default:

```bash
npm test          # setup login + all menu suites
npm run test:headed
npm run test:ui
npm run report    # open the last HTML report
```

Filter a single menu: `npx playwright test tests/users.spec.ts`

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
- `artifacts/` and `.auth/` are generated — add them to `.gitignore` if the
  suite is run from a clean checkout.
