import { test as base } from "@playwright/test";

// Every menu test runs with the session saved by tests/suite/suite.setup.spec.ts (the
// runner's "data-setup" project) and with
// calls to the optional local runner service (localhost:9090) aborted — it is
// only reachable when a companion process runs on the tester's machine, and
// its absence must not slow the suite down.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route("http://localhost:9090/**", (route) => route.abort());
    await use(context);
  }
});

export { expect } from "@playwright/test";
