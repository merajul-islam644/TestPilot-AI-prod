import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blocksClient } from "../blocks/client";
import { defaultDictionary } from "./dictionary";
import type { TranslationKey } from "./dictionary";

type Dictionary = Record<string, string>;
export type LocalizationLanguage = { code: string; isDefault: boolean; name: string };
type LocalizationValue = {
  language: string;
  languages: LocalizationLanguage[];
  setLanguage: (language: string) => void;
  t: (key: TranslationKey, fallback?: string) => string;
};

const LocalizationContext = createContext<LocalizationValue | undefined>(undefined);
const LANGUAGE_KEY = "blocks-app:language";

// Module-level mirror of the resolved dictionary: hook-free modules (the
// demo store raising toasts) translate through this instead of useT().
let activeCloudDictionary: Dictionary = {};

/** Hook-free lookup mirroring t(): cloud value first, built-in fallback next. */
export function translate(key: TranslationKey): string {
  return activeCloudDictionary[key] ?? defaultDictionary[key] ?? key;
}
// One module per screen would keep the initial payload small, but this
// starter only ships Profile -- add module names here as you add pages.
const MODULES = ["common"];

function normalizeLanguage(raw: Record<string, unknown>): LocalizationLanguage {
  const code = raw.languageCode ?? raw.code ?? raw.culture ?? "en";
  const name = raw.languageName ?? raw.displayName ?? raw.name ?? String(code);
  return { code: String(code), isDefault: Boolean(raw.isDefault), name: String(name) };
}

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [languageOverride, setLanguageOverride] = useState(() => localStorage.getItem(LANGUAGE_KEY) ?? "");

  const languagesQuery = useQuery({
    queryFn: () => blocksClient.localization.languages(),
    queryKey: ["i18n", "languages"],
    staleTime: 5 * 60_000
  });

  const languages = useMemo(() => (languagesQuery.data ?? []).map(normalizeLanguage), [languagesQuery.data]);
  // Until /Language/Gets resolves (or on a tenant with none configured), fall
  // back to "en" -- it must still match a real languageCode for translations
  // to resolve, so this is a startup default rather than a guaranteed hit.
  const defaultLanguage = languages.find((entry) => entry.isDefault)?.code ?? languages[0]?.code ?? "en";
  const language = languageOverride || defaultLanguage;

  function setLanguage(next: string) {
    localStorage.setItem(LANGUAGE_KEY, next);
    setLanguageOverride(next);
  }

  // One cached query per module for the active language -- TanStack Query
  // dedupes/caches by queryKey, so switching languages (or remounting) never
  // re-fetches a (language, module) pair that's already in cache.
  const moduleQueries = useQueries({
    queries: MODULES.map((moduleName) => ({
      queryFn: () => blocksClient.localization.translations(moduleName, language),
      queryKey: ["i18n", "translations", language, moduleName],
      staleTime: 5 * 60_000
    }))
  });

  const cloudDictionary = useMemo<Dictionary>(() => {
    const merged: Dictionary = {};
    moduleQueries.forEach((query, index) => {
      const moduleName = MODULES[index];
      for (const [key, value] of Object.entries(query.data ?? {})) {
        // A language configured on the tenant but not yet translated gets a
        // generated UILM file full of "[ KEY MISSING ]" placeholders — skip
        // those (and empties) so the built-in default dictionary still shows.
        if (!value || value === "[ KEY MISSING ]") continue;
        const appKey = moduleName === "common" && key in defaultDictionary ? key : `${moduleName}.${key}`;
        merged[appKey] = value;
      }
    });
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleQueries.map((query) => query.dataUpdatedAt).join()]);

  // Keep the hook-free mirror in sync with the resolved dictionary.
  useEffect(() => {
    activeCloudDictionary = cloudDictionary;
  }, [cloudDictionary]);

  const value = useMemo<LocalizationValue>(() => ({
    language,
    languages,
    setLanguage,
    t: (key, fallback) => cloudDictionary[key] ?? defaultDictionary[key] ?? fallback ?? key
  }), [cloudDictionary, language, languages]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useT() {
  const context = useContext(LocalizationContext);
  if (!context) throw new Error("useT must be used within LocalizationProvider");
  return context;
}
