import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useCurrentUser } from "../profile/useCurrentUser";
import { listRolePermissions } from "../../lib/blocks/iamRoles";
import { useAuth } from "../../app/providers/AuthProvider";

// Facet-1 access control: read-only feature gating by the signed-in user's
// EFFECTIVE permissions. Live-verified (2026-11-11): this deployment's
// iam.me() returns `permissions: []` for role-based access — that field
// lists only DIRECTLY granted permissions (rare), while the gateway checks
// the union of the user's ROLES. So the effective set is computed here:
// me().roles → permissions.list({ roles: [slug] }) per role → union.
// Shares the per-role query cache with the roles admin screens.

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The signed-in user's effective permission slugs (resources) + roles, and
 *  `ready` so callers can distinguish "checked and missing" from "not loaded
 *  yet" — controls stay hidden until the check has actually run. */
export function useMyAccess() {
  const { status: authStatus } = useAuth();
  const me = useCurrentUser();

  const roleSlugs = useMemo(() => {
    const record = (me.data?.data ?? {}) as Record<string, unknown>;
    return stringList(record.roles);
  }, [me.data]);

  // One held-permissions fetch per role the user holds (typically one —
  // e.g. clouduser). Same cache key as the roles admin's editor, so opening
  // the permission editor never refetches.
  const roleQueries = useQueries({
    queries: roleSlugs.map((slug) => ({
      enabled: authStatus === "authenticated" && Boolean(slug),
      queryFn: () => listRolePermissions(slug),
      queryKey: ["iam", "permissions", "for-role", slug],
      retry: false,
      staleTime: 60_000
    }))
  });

  return useMemo(() => {
    const record = (me.data?.data ?? {}) as Record<string, unknown>;
    const permissions = new Set<string>(stringList(record.permissions));
    roleQueries.forEach((query) => {
      (query.data?.data ?? []).forEach((perm) => {
        const entry = perm as Record<string, unknown>;
        if (typeof entry.resource === "string" && entry.resource !== "") permissions.add(entry.resource);
      });
    });
    return {
      permissions,
      // "ready" once me() AND every role fetch has succeeded — before that
      // the verdict is unknown, not "missing".
      ready: me.isSuccess && roleQueries.every((query) => query.isSuccess),
      roles: new Set(roleSlugs)
    };
  }, [me.data, me.isSuccess, roleQueries, roleSlugs]);
}

/** `undefined` while the check is still running — render the control (or
 *  not) only once the verdict is known, so admins don't see buttons flash. */
export function useHasPermission(permission: string): boolean | undefined {
  const { permissions, ready } = useMyAccess();
  if (!ready) return undefined;
  return permissions.has(permission);
}

export function useHasRole(role: string): boolean | undefined {
  const { ready, roles } = useMyAccess();
  if (!ready) return undefined;
  return roles.has(role);
}
