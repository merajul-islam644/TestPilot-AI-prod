import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { adminListOrganizations, getOrgConfig, getSignupSettings, myOrganizations } from "../../lib/blocks/organizations";

// Read-side hooks for the Organizations admin page and the org switcher.
// Every response is loosely typed — extraction is defensive and degrades one
// control, never the page. The admin list/config reads are permission-gated
// server-side; a 403 shows the panel's fallback note instead of an error.

export type OrgRow = {
  description: string;
  email: string;
  itemId: string;
  name: string;
  websiteUrl: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Flattens the list payload (data array) into rows; tolerates the
 *  { organizations: [...] } shape the tenant answered with live. */
export function toOrgRows(payload: unknown): OrgRow[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.organizations)
      ? record.organizations
      : [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      description: asString(entry.description),
      email: asString(entry.email),
      itemId: asString(entry.itemId),
      name: asString(entry.name),
      websiteUrl: asString(entry.websiteUrl)
    }))
    .filter((org) => org.itemId !== "");
}

/** The admin org table. Server-side search when a term is present
 *  (Filter.Search), client-side narrowing otherwise — IAM refuses filter
 *  fields on an empty search. */
export function useOrgsAdminPage(search: string) {
  const { status } = useAuth();
  const query = useQuery({
    enabled: status === "authenticated",
    placeholderData: (previous) => previous,
    queryFn: () => adminListOrganizations(search),
    queryKey: ["iam", "organizations", "admin", search.trim()]
  });

  const rows = useMemo(() => {
    const all = toOrgRows(query.data);
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    // Server already searched — narrow again client-side as a fallback for
    // deployments that ignore the term (same pattern as the users list).
    return all.filter((org) =>
      org.name.toLowerCase().includes(needle) ||
      org.description.toLowerCase().includes(needle) ||
      org.email.toLowerCase().includes(needle)
    );
  }, [query.data, search]);

  return { ...query, rows };
}

/** The org switcher's source — the signed-in user's own organizations. */
export function useMyOrganizations() {
  const { status } = useAuth();
  const query = useQuery({
    enabled: status === "authenticated",
    queryFn: myOrganizations,
    queryKey: ["iam", "organizations", "my"],
    retry: false,
    staleTime: 60_000
  });

  const organizations = useMemo(() => toOrgRows(query.data), [query.data]);
  return { ...query, organizations };
}

export type OrgConfig = {
  allowOrgCreationFromCloud: boolean;
  allowOrgCreationFromConstruct: boolean;
  allowOrgCreationFromPortal: boolean;
  allowOrgCreationFromSignup: boolean;
  /** Read alongside isMultiOrgEnable on the real payload — passed back
   *  untouched on save (the CLI also merges it). */
  consentForMultiOrgEnable: boolean;
  isMultiOrgEnabled: boolean;
  /** Live-verified field name (2026-11-11) — NOT `orgNameUniqueness`. */
  isOrgNameUniquenessEnabled: boolean;
};

export function parseOrgConfig(record: Record<string, unknown>): OrgConfig {
  const flag = (key: string) => record[key] === true;
  return {
    allowOrgCreationFromCloud: flag("allowOrgCreationFromCloud"),
    allowOrgCreationFromConstruct: flag("allowOrgCreationFromConstruct"),
    allowOrgCreationFromPortal: flag("allowOrgCreationFromPortal"),
    allowOrgCreationFromSignup: flag("allowOrgCreationFromSignup"),
    consentForMultiOrgEnable: flag("consentForMultiOrgEnable"),
    isMultiOrgEnabled: flag("isMultiOrgEnabled"),
    isOrgNameUniquenessEnabled: flag("isOrgNameUniquenessEnabled")
  };
}

export function useOrgConfig() {
  const { status } = useAuth();
  const query = useQuery({
    enabled: status === "authenticated",
    queryFn: getOrgConfig,
    // Expected 403 for users without the tenant-configs read — degrade, don't retry.
    queryKey: ["iam", "organizations", "config"],
    retry: false,
    staleTime: 60_000
  });

  const config = useMemo<OrgConfig | undefined>(
    () => (query.data ? parseOrgConfig(query.data) : undefined),
    [query.data]
  );

  return { ...query, config };
}

export type SignupSettings = {
  defaultPermissionsForNewUser: string[];
  defaultRolesForNewUser: string[];
  isEmailPasswordSignUpEnabled: boolean;
  isSignUpEnable: boolean;
  isSSoSignUpEnabled: boolean;
};

/** GET spelling, live-verified 2026-11-11: booleans are
 *  `isEmailPasswordSignUpEnabled` / `isSSoSignUpEnabled` (+ master
 *  `isSignUpEnable`), lists are `defaultRolesForNewUser` /
 *  `defaultPermissionsForNewUser`. The POST renames only the lists
 *  (`...ForNewUserOnSignUp`) — organizations.saveSignupSettings maps them. */
export function parseSignupSettings(record: Record<string, unknown>): SignupSettings {
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    defaultPermissionsForNewUser: list(record.defaultPermissionsForNewUser),
    defaultRolesForNewUser: list(record.defaultRolesForNewUser),
    isEmailPasswordSignUpEnabled: record.isEmailPasswordSignUpEnabled === true,
    isSignUpEnable: record.isSignUpEnable === true,
    isSSoSignUpEnabled: record.isSSoSignUpEnabled === true
  };
}

export function useSignupSettings() {
  // Deliberately NOT gated on auth status — the signup page reads this
  // publicly (IAM only needs the x-blocks-key the SDK already sends).
  const query = useQuery({
    queryFn: getSignupSettings,
    queryKey: ["iam", "signup-settings"],
    retry: false,
    staleTime: 60_000
  });

  const settings = useMemo<SignupSettings | undefined>(
    () => (query.data ? parseSignupSettings(query.data) : undefined),
    [query.data]
  );

  return { ...query, settings };
}
