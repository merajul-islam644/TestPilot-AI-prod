import { createContext, useContext } from "react";

type ShellContextValue = {
  /** Opens the "Create a test run" dialog mounted by the shell. */
  openNewRun: () => void;
  /** Navigates to the project's Tests tab (the workbench) — the escape
   *  hatch when a run modal opens on a project with no suites yet. */
  openProjectTests: (projectId: string) => void;
};

export const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used within AppShell");
  return context;
}
