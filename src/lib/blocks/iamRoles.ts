import { blocksClient } from "./client";

// --- Admin: role & permission definitions ------------------------------------
// The write side of RBAC (create/edit roles, attach permissions). Every call
// here is a sensitive IAM mutation — the UI must show the admin exactly what
// will change and only fire on their explicit confirm; the agent never calls
// these on its own initiative. Reads live in iamUsers.ts / hooks.

/** Defines a role. IAM keys roles off `slug` — when omitted, the backend
 *  derives it from the name. `parentRoleSlug` nests it in the hierarchy;
 *  `canCreateOwn` lets holders create sub-roles. */
export function createRole(request: Record<string, unknown>) {
  return blocksClient.iam.roles.create(request);
}

/** Edits a role definition. The endpoint REPLACES the record, so callers
 *  must send the full merged body (read the role first, change fields, send
 *  everything back) — a bare rename would clear the description and detach
 *  the parent. Roles have no delete in IAM; archive is not exposed via SDK. */
export function updateRole(request: Record<string, unknown>) {
  return blocksClient.iam.roles.update(request);
}

/** Attach/detach permissions on a role. ADDITIVE/SUBTRACTIVE — send only the
 *  delta. Both lists take permission **itemIds** (the CLI resolves resource
 *  strings before sending; SDK callers pass ids directly). `slug` is the
 *  ROLE's slug, not its itemId. */
export function assignRolePermissions(request: Record<string, unknown>) {
  return blocksClient.iam.roles.assignPermissions(request);
}

/** Permissions a role currently holds — the "pre-checked" set for the role
 *  permission editor. Same list endpoint as the catalog, filtered by role:
 *  CLI exposes this as `permissions list --roles <slug>`; the body field is
 *  the flat `roles` slug array. */
export function listRolePermissions(slug: string) {
  return blocksClient.iam.permissions.list({ pageNo: 1, pageSize: 500, query: "", roles: [slug] });
}
