import { blocksClient } from "./client";

// --- Organizations: admin CRUD, tenant config, signup policy ------------------
// Gating slugs (IAM permission catalog): reading orgs needs
// `blocks-iam::iam::organizations`, create/update need
// `blocks-iam::iam::mutate-organizations`; the tenant-level config + signup
// policy panels are gated like other tenant settings
// (`blocks-iam::iam::mutate-tenant-configs` for saves).
//
// Discipline (blocks-iam-organizations skill): organizations are a tenant
// isolation boundary — every create/update/save below must be a visible,
// user-confirmed action in the UI (exact fields, old vs new), never an
// agent-initiated or scripted call.

/** Admin browse. `Page` is ZERO-based here. IAM refuses any `Filter.*` field
 *  unless `Filter.Search` is a non-empty term — so the search term is only
 *  sent when present, and empty-search filtering happens client-side. */
export function adminListOrganizations(search: string) {
  const term = search.trim();
  const query: Record<string, string | number> = { Page: 0, PageSize: 100 };
  if (term) query["Filter.Search"] = term;
  return blocksClient.iam.organizations.list(query);
}

export function getOrganization(id: string) {
  return blocksClient.iam.organizations.get(id);
}

export function createOrganization(request: Record<string, unknown>) {
  return blocksClient.iam.organizations.create(request);
}

export function updateOrganization(id: string, request: Record<string, unknown>) {
  return blocksClient.iam.organizations.update(id, request);
}

/** Tenant org config — multi-org enablement + where org creation is allowed.
 *  saveConfig MERGES, but callers spread the read value back so the confirm
 *  dialog reflects the full resulting policy. */
export function getOrgConfig(): Promise<Record<string, unknown>> {
  return blocksClient.iam.organizations.getConfig();
}

export function saveOrgConfig(request: Record<string, unknown>) {
  return blocksClient.iam.organizations.saveConfig(request);
}

/** Public (no auth needed) — the signup page reads this before rendering. */
export function getSignupSettings(): Promise<Record<string, unknown>> {
  return blocksClient.iam.signupSettings.get();
}

/** Saves signup policy. FIELD NAMES dry-run-verified against the live CLI
 *  (2026-11-11): booleans match the GET spelling, but the lists rename —
 *  GET says `defaultRolesForNewUser`/`defaultPermissionsForNewUser`, the
 *  POST stores `defaultRolesForNewUserOnSignUp`/
 *  `defaultPermissionsForNewUserOnSignUp`, and ALL FOUR fields must be sent
 *  every time (omitted booleans become false, omitted lists empty). */
export function saveSignupSettings(request: {
  defaultPermissionsForNewUserOnSignUp: string[];
  defaultRolesForNewUserOnSignUp: string[];
  isEmailPasswordSignUpEnabled: boolean;
  isSSoSignUpEnabled: boolean;
}) {
  return blocksClient.iam.signupSettings.save(request);
}

/** The signed-in user's own organizations — the org switcher's source.
 *  Requires an authenticated session. */
export function myOrganizations() {
  return blocksClient.iam.organizations.my();
}
