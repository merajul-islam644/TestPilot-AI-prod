// The default-environment preference lives here. The workspace NAME used to
// live here too — a localStorage override that Settings wrote and the brand
// read — but the app's name is a build-time identity now (src/app/appName.ts),
// so that whole rename system was removed.
//
// The keys are namespaced with THIS app's own prefix on purpose: the older
// generic "testpilot:" keys collided with the user's other locally-hosted
// apps built from the same template sharing the origin's localStorage.
const DEFAULT_ENV_KEY = "tpai:defaultEnv";
const DEFAULT_ENV_EVENT = "tpai:defaultenv-changed";

export type DefaultEnvironment = "production" | "staging" | "sandbox";

export function getDefaultEnvironment(): DefaultEnvironment {
  const stored = localStorage.getItem(DEFAULT_ENV_KEY);
  return stored === "production" || stored === "sandbox" ? stored : "staging";
}

export function setDefaultEnvironment(value: DefaultEnvironment) {
  localStorage.setItem(DEFAULT_ENV_KEY, value);
  window.dispatchEvent(new Event(DEFAULT_ENV_EVENT));
}
