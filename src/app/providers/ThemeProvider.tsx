import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const THEME_KEY = "testpilot:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  // Stamp an explicit theme either way -- an explicit "light" must beat an
  // OS-level dark preference, so "just remove the attribute for light" is
  // not enough. index.html stamps the same value before first paint to
  // avoid a light flash for dark-mode users.
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved: ResolvedTheme = preference === "system" ? system : preference;

  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = () => setSystem(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(resolved);
    localStorage.setItem(THEME_KEY, preference);
  }, [preference, resolved]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolved,
    setPreference
  }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
