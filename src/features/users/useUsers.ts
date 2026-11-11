import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlocksOrganization, BlocksPermission, BlocksRole, BlocksUser } from "@seliseblocks/client";
import { useAuth } from "../../app/providers/AuthProvider";
import {
  checkEmailAvailable,
  getUser,
  listAssignableRoles,
  listOrganizations,
  listPermissions,
  listRoles,
  listUsers
} from "../../lib/blocks/iamUsers";

// Read-side hooks for the Users admin page. Every response is loosely typed
// (Record<string, unknown>) — extraction below treats fields defensively and
// falls back to empty so a refused side-read (e.g. the roles list 403s for a
// narrow role) degrades one control, never the page.

export type UserRow = BlocksUser & { itemId: string };

/** IAM returns a user's roles in two shapes depending on endpoint: a flat
 *  slug array, or an object keyed by organization (`{ default: ["x"] }`).
 *  This flattens both. With an orgId, the matching key wins when present. */
export function userRoleSlugs(user: BlocksUser | undefined, orgId?: string): string[] {
  const roles = user?.roles;
  if (Array.isArray(roles)) return roles.filter((role): role is string => typeof role === "string");
  if (roles && typeof roles === "object") {
    const record = roles as Record<string, unknown>;
    if (orgId && Array.isArray(record[orgId])) {
      return (record[orgId] as unknown[]).filter((role): role is string => typeof role === "string");
    }
    return [...new Set(Object.values(record).flatMap((list) =>
      Array.isArray(list) ? list.filter((role): role is string => typeof role === "string") : []
    ))];
  }
  return [];
}

export function useUsersPage(params: { orgFilter: string; pageNo: number; pageSize: number; roleFilter: string; search: string; statusFilter: string }) {
  const { status: authStatus } = useAuth();
  const { orgFilter, pageNo, pageSize, roleFilter, search, statusFilter } = params;

  // Live-verified contract (2026-11-11): IAM's user list takes the text term
  // in `query` (a `search` field is ignored), and `filter.status` is a Status
  // OBJECT ({ active, inactive } booleans) — an array is refused with a 400
  // naming "Iam.DomainService.Dtos.Status". `query` travels on every call;
  // IAM rejects a filter-only body asking for "the query field".
  const request: Record<string, unknown> = { pageNo, pageSize, query: search.trim() };
  const filter: Record<string, unknown> = {};
  if (statusFilter === "active") filter.status = { active: true, inactive: false };
  else if (statusFilter === "inactive") filter.status = { active: false, inactive: true };
  if (roleFilter) filter.roles = [roleFilter];
  if (orgFilter) filter.organizationIds = [orgFilter];
  if (Object.keys(filter).length > 0) request.filter = filter;

  return useQuery({
    enabled: authStatus === "authenticated",
    placeholderData: (previous) => previous,
    // Keep the previous page on screen while the next one loads, so paging
    // doesn't flash a skeleton over a working table on every arrow click.
    queryFn: () => listUsers(request),
    queryKey: ["iam", "users", "list", pageNo, pageSize, search.trim(), statusFilter, roleFilter, orgFilter]
  });
}

export function useUserDetail(userId: string | undefined, organizationId?: string) {
  const { status: authStatus } = useAuth();
  return useQuery({
    enabled: authStatus === "authenticated" && Boolean(userId),
    queryFn: () => getUser(userId as string, organizationId ? { organizationId } : undefined),
    queryKey: ["iam", "users", "get", userId, organizationId ?? ""]
  });
}

// The invite form's duplicate-email check. Runs only for a plausible address;
// `undefined` (check unavailable) renders no verdict — IAM still rejects a
// duplicate server-side on save.
export function useEmailAvailable(email: string) {
  const plausible = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return useQuery({
    enabled: plausible,
    queryFn: () => checkEmailAvailable(email.trim()),
    queryKey: ["iam", "users", "emailAvailable", email.trim().toLowerCase()],
    retry: false,
    staleTime: 30_000
  });
}

export function useAssignableRoles() {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated",
    queryFn: listAssignableRoles,
    queryKey: ["iam", "roles", "assignable"],
    retry: false,
    staleTime: 5 * 60_000
  });

  // assignable() returns a { hierarchy, standalone } payload (both arrays of
  // role objects) — live-verified 2026-11-11. Accept a bare array too, keep
  // only entries with something nameable, and dedupe by slug.
  const roles = useMemo(() => {
    const payload = query.data as { hierarchy?: unknown; standalone?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(payload)
      ? payload
      : [
          ...(Array.isArray(payload?.hierarchy) ? payload.hierarchy : []),
          ...(Array.isArray(payload?.standalone) ? payload.standalone : [])
        ];
    const bySlug = new Map<string, { name: string; slug: string }>();
    raw
      .map((entry) => entry as BlocksRole)
      .filter((role) => typeof (role.slug ?? role.name) === "string" && (role.slug ?? role.name) !== "")
      .forEach((role) => {
        const slug = String(role.slug ?? role.name);
        bySlug.set(slug, { name: typeof role.name === "string" ? role.name : "", slug });
      });
    return [...bySlug.values()];
  }, [query.data]);

  return { ...query, roles };
}

export function useRoles() {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated",
    queryFn: () => listRoles(),
    queryKey: ["iam", "roles", "list"],
    retry: false,
    staleTime: 5 * 60_000
  });

  const roles = useMemo(() => (query.data?.data ?? [])
    .filter((role) => typeof (role.slug ?? role.name) === "string" && (role.slug ?? role.name) !== "")
    .map((role) => ({ name: typeof role.name === "string" ? role.name : "", slug: String(role.slug ?? role.name) })),
  [query.data]);

  return { ...query, roles };
}

export function useOrganizations() {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated",
    queryFn: listOrganizations,
    queryKey: ["iam", "organizations", "list"],
    retry: false,
    staleTime: 5 * 60_000
  });

  // Live-verified: this tenant answers `{ organizations: [...], totalCount }`
  // — no `data` key — so both spellings are accepted.
  const organizations = useMemo(() => {
    const raw = query.data?.data ?? (query.data as { organizations?: BlocksOrganization[] } | undefined)?.organizations ?? [];
    return raw
      .filter((org) => typeof org.itemId === "string" && org.itemId !== "")
      .map((org: BlocksOrganization) => ({ id: org.itemId as string, name: typeof org.name === "string" ? org.name : org.itemId as string }));
  }, [query.data]);

  return { ...query, organizations };
}

export type PermissionOption = { description: string; itemId: string; name: string; resource: string; slug: string };

export function usePermissions() {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated",
    queryFn: () => listPermissions(),
    queryKey: ["iam", "permissions", "list"],
    retry: false,
    staleTime: 5 * 60_000
  });

  // Assignment keys off the `resource` identifier (the `mod::area::action`
  // string — live-verified 2026-11-11; there is no separate slug field),
  // with `name` as the human label. itemId stays the last-resort fallback.
  const permissions = useMemo<PermissionOption[]>(() => {
    const raw = query.data?.data ?? [];
    return raw
      .filter((perm): perm is BlocksPermission & { itemId: string } => typeof perm.itemId === "string" && perm.itemId !== "")
      .map((perm) => {
        const record = perm as Record<string, unknown>;
        const slug = [record.slug, perm.resource, record.key]
          .find((value) => typeof value === "string" && value !== "");
        return {
          description: typeof record.description === "string" ? record.description : "",
          itemId: perm.itemId,
          name: typeof record.name === "string" ? record.name : "",
          resource: typeof perm.resource === "string" ? perm.resource : "",
          slug: typeof slug === "string" ? slug : perm.itemId
        };
      });
  }, [query.data]);

  return { ...query, permissions };
}
