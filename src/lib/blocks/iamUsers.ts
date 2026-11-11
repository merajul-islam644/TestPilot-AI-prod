import { blocksClient } from "./client";

// --- Admin: other users' IAM records -----------------------------------------
// Thin wrappers over `blocksClient.iam.users.*` (plus the role/org reads the
// Users page needs for its pickers). Kept apart from auth.ts, which is the
// signed-in user acting on THEIR OWN account — everything here acts on other
// people's records, and the server gates each call by the admin's role.
//
// Every request shape is IAM's contract; the SDK types them as Record
// passthrough, so these wrappers only pin the well-known fields. Pages render
// IAM's own errors as-is rather than pre-validating.

/** Paged/filtered user query. POST-read: `{ pageNo, pageSize, query, filter }`
 *  travels in the body, not the query string. Live-verified (2026-11-11): the
 *  text term goes in `query` (`search` is ignored), and `filter.status` is a
 *  Status object — `{ active, inactive }` booleans; an array is refused 400.
 *  Other documented filter fields: `roles` (slugs), `organizationIds`. */
export function listUsers(request: Record<string, unknown> = {}) {
  return blocksClient.iam.users.list(request);
}

/** One user record, optionally in a specific organization's context. */
export function getUser(id: string, options?: { organizationId?: string }) {
  return blocksClient.iam.users.get(id, options);
}

/** Duplicate-email check for the invite form. Prefers `emailAvailable`
 *  (needs `blocks-iam::iam::email-available`); when that endpoint is refused
 *  (403) falls back to `exists` (needs `blocks-iam::iam::users` — anyone on
 *  the Users page already has it, since the list itself is gated by it).
 *  Response casing varies (`isAvailable`/`IsAvailable`), so both are checked. */
export async function checkEmailAvailable(email: string): Promise<boolean | undefined> {
  try {
    const check = await blocksClient.iam.users.emailAvailable({ email });
    if (typeof check.isAvailable === "boolean") return check.isAvailable;
    if (typeof check.IsAvailable === "boolean") return check.IsAvailable;
    return undefined;
  } catch {
    try {
      const exists = await blocksClient.iam.users.exists(email) as { userId?: unknown } | undefined;
      // `userId` is null when the address is unregistered.
      return exists?.userId ? false : true;
    } catch {
      return undefined;
    }
  }
}

/** Invites/provisions a user in the active tenant/organization. Roles are
 *  referenced by slug, not item id. */
export function createUser(request: Record<string, unknown>) {
  return blocksClient.iam.users.create(request);
}

/** Edits profile fields. Sparse patch: an omitted field keeps its stored
 *  value — this endpoint IGNORES roles/permissions/MFA fields (change access
 *  with updateUserAccess, not here). */
export function updateUser(id: string, request: Record<string, unknown>) {
  return blocksClient.iam.users.update(id, request);
}

/** Removes access without deleting the record. Takes only the userId —
 *  IAM records no reason for deactivation. */
export function deactivateUser(userId: string) {
  return blocksClient.iam.users.deactivate({ userId });
}

/** Restores a deactivated account. `reason` is REQUIRED — IAM answers 400
 *  without it; the UI must collect one before calling. */
export function activateUser(userId: string, reason: string) {
  return blocksClient.iam.users.activate({ reason, userId });
}

/** Grants/changes a user's roles+permissions for an organization. Roles by
 *  slug. A non-empty `roles` list REPLACES that org's current list; an
 *  omitted one is kept. */
export function updateUserAccess(request: Record<string, unknown>) {
  return blocksClient.iam.users.updateAccess(request);
}

/** Removes a user's access to an organization (all its roles with it). */
export function revokeUserAccess(request: Record<string, unknown>) {
  return blocksClient.iam.users.revokeAccess(request);
}

/** Roles the current admin may assign — the access/invite pickers should only
 *  offer these. Unknown shape by design; callers extract defensively. */
export function listAssignableRoles(): Promise<unknown> {
  return blocksClient.iam.roles.assignable();
}

/** All role definitions (for the list-page role filter). */
export function listRoles(request: Record<string, unknown> = { pageNo: 1, pageSize: 100 }) {
  return blocksClient.iam.roles.list(request);
}

/** Permission definitions — the source for the access dialog's picker.
 *  Same IAM list contract as users: `query` carries the text term. */
export function listPermissions(request: Record<string, unknown> = { pageNo: 1, pageSize: 500, query: "" }) {
  return blocksClient.iam.permissions.list(request);
}

/** Organizations in the tenant (org filter + access dialogs). GET-read:
 *  `Page` is zero-based; do NOT send `Filter.*` without a search term —
 *  IAM refuses filter fields on an empty search. */
export function listOrganizations() {
  return blocksClient.iam.organizations.list({ Page: 0, PageSize: 100 });
}
