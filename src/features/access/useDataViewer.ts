import { useAuth } from "../../app/providers/AuthProvider";
import { useCurrentUser } from "../profile/useCurrentUser";
import { userRoleSlugs } from "../users/useUsers";

/** The role slug that turns the whole app into a read-only data viewer:
 *  admin menus (users/roles/organizations/help), the org switcher, the
 *  Playwright editor tab, run buttons and every create/edit/delete control
 *  stay hidden. Rename here if the tenant's role slug ever changes — this
 *  constant is the only place that knows it. */
const VIEWER_ROLE_SLUG = "dataviewer";

/**
 * True for users holding the `dataviewer` role.
 *
 * The role read is deliberately a FLATTENING one (userRoleSlugs): IAM
 * returns a user's roles in two shapes depending on endpoint — a flat slug
 * array (account-level, e.g. ["clouduser"]) or an object keyed by
 * organization (`{ default: ["x"], <orgId>: ["dataviewer"] }`) — and the
 * naive array read saw only the first, which is why an org-assigned
 * dataviewer was never detected. With an active org claim the matching
 * org's roles win; without one (Default org) all of the user's org roles
 * flatten together.
 *
 * The role read is deliberately a FLATTENING one (userRoleSlugs): IAM
 * returns a user's roles in two shapes depending on endpoint — a flat slug
 * array (account-level, e.g. ["clouduser"]) or an object keyed by
 * organization (`{ default: ["x"], <orgId>: ["dataviewer"] }`) — and the
 * naive array read saw only the first, which is why an org-assigned
 * dataviewer was never detected. With an active org claim the matching
 * org's roles win; without one (Default org) all of the user's org roles
 * flatten together.
 *
 * Unknown is NEVER viewer: while me() is loading or fails, this returns
 * false and the full UI renders. Only a confirmed dataviewer slug flips
 * the read-only mode on.
 */
export function useIsDataViewer(): boolean {
  const { claims } = useAuth();
  const me = useCurrentUser();
  const orgId = typeof claims?.org_id === "string" ? (claims.org_id as string) : undefined;
  const record = me.data?.data;
  const slugs = userRoleSlugs(record, orgId);
  // Fail-OPEN: only a POSITIVE dataviewer match hides anything. The earlier
  // hide-while-unknown convention turned a stalled or refused role read
  // into a PERMANENT read-only app for admins — the exact "you did this
  // for clouduser" bug. An admin whose role data is slow, flat, or
  // unreadable must always get the full UI back.
  return slugs.some((slug) => slug.toLowerCase() === VIEWER_ROLE_SLUG);
}
