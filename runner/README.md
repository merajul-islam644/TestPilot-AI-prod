# testpilot-runner

The piece of TestPilot AI that actually executes Playwright specs. The SPA
runs in a browser and cannot launch Chromium, so it POSTs spec files here;
this service materializes a throwaway Playwright project in the OS temp dir,
runs it, and returns a compact result set shaped like the app's `CaseResult`.

## Run it

```
npm install
npx playwright install chromium
npm start          # http://localhost:9090
```

## API

- `GET /health` → `{ ok, runner, version, busy }`
- `POST /run` — body:
  ```json
  {
    "name": "optional run label",
    "baseURL": "https://site-under-test",
    "files": [{ "name": "login.spec.mjs", "content": "import { test, expect } from '@playwright/test'; ..." }]
  }
  ```
  Response: `{ ok, name, summary: { total, passed, failed, skipped, durationMs }, cases: [{ title, file, status, durationMs, error }] }`

Constraints (v1): one run at a time (409 if busy), max 20 files, 200 KB per
file, 150 s per run. CORS is locked to the TestPilot dev origins. Spec
filenames must be flat `*.spec.{mjs,js,ts}` / `*.test.*` names.

This service is deliberately outside Blocks: Blocks Functions are too
lightweight to host Chromium, and the data gateway only accepts real
end-user sessions -- so the app (with its user session) writes the results
the runner returns into the gateway itself.
