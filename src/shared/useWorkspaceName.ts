import { useEffect, useState } from "react";

// The workspace name is a local preference: Settings writes it, the sidebar
// brand and the sign-in card read it. A custom event bridges same-tab
// updates (the browser only fires `storage` events across tabs).
const WORKSPACE_KEY = "testpilot:workspaceName";
const WORKSPACE_EVENT = "testpilot:workspace-changed";
const DEFAULT_ENV_KEY = "testpilot:defaultEnv";
const DEFAULT_ENV_EVENT = "testpilot:defaultenv-changed";

export function getWorkspaceName(): string {
  return localStorage.getItem(WORKSPACE_KEY) ?? "";
}

export function setWorkspaceName(value: string) {
  localStorage.setItem(WORKSPACE_KEY, value);
  window.dispatchEvent(new Event(WORKSPACE_EVENT));
}

export function useWorkspaceName(): string {
  const [value, setValue] = useState(getWorkspaceName);
  useEffect(() => {
    const onChange = () => setValue(getWorkspaceName());
    window.addEventListener(WORKSPACE_EVENT, onChange);
    return () => window.removeEventListener(WORKSPACE_EVENT, onChange);
  }, []);
  return value;
}

export type DefaultEnvironment = "production" | "staging" | "sandbox";

export function getDefaultEnvironment(): DefaultEnvironment {
  const stored = localStorage.getItem(DEFAULT_ENV_KEY);
  return stored === "production" || stored === "sandbox" ? stored : "staging";
}

export function setDefaultEnvironment(value: DefaultEnvironment) {
  localStorage.setItem(DEFAULT_ENV_KEY, value);
  window.dispatchEvent(new Event(DEFAULT_ENV_EVENT));
}
