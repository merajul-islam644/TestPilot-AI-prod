// The route context lives in its own module, separate from routes.tsx,
// so non-page components (e.g. the workbench subtree) can read
// navigate/params WITHOUT importing routes.tsx — routes.tsx imports the
// pages, and a workbench → routes edge closed a circular import that
// made vite full-reload the page on HMR updates (killing in-flight run
// dispatches). Page-level files may keep importing useRoute from
// routes.tsx, which re-exports from here.
import { createContext, useContext } from "react";

export type RouteParams = Record<string, string>;
export type RouteState = { navigate: (to: string) => void; params: RouteParams; path: string };

export const RouteContext = createContext<RouteState | undefined>(undefined);

export function useRoute(): RouteState {
  const context = useContext(RouteContext);
  if (!context) throw new Error("useRoute must be used within AppRouter");
  return context;
}
