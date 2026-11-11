import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { listRoles } from "../../lib/blocks/iamUsers";
import { listRolePermissions } from "../../lib/blocks/iamRoles";
import { permissionOption, usePermissions, type PermissionOption } from "../users/useUsers";

// Read-side hooks for the Roles admin page. The write side (create/update/
// assignPermissions) lives in lib/blocks/iamRoles.ts and is called directly
// from the dialogs' confirmed submit handlers — same pattern as Users.

/** One role definition from roles.list — loosely typed upstream, so the
 *  fields the page shows are pinned here and `raw` keeps the full record
 *  (roles.update REPLACES, so edits must send the merged body back). */
export type RoleRow = {
  canCreateOwn: boolean;
  description: string;
  /** IAM's own permission-count for the role (may be absent). */
  permissionCount?: number;
  raw: Record<string, unknown>;
  slug: string;
  itemId: string;
  name: string;
  parentRoleSlug: string | null;
};

export function useRolesPage(search: string) {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated",
    placeholderData: (previous) => previous,
    queryFn: () => listRoles({ pageNo: 1, pageSize: 100, query: search.trim() }),
    queryKey: ["iam", "roles", "list", search.trim()]
  });

  const roles = useMemo<RoleRow[]>(() => {
    const rows = (query.data?.data ?? []).filter((role): role is Record<string, unknown> =>
      Boolean(role) && typeof (role as Record<string, unknown>).slug === "string" && (role as Record<string, unknown>).slug !== ""
    );
    // The server may ignore the text term (verified on users.list) — apply
    // the same client-side fallback over the loaded set.
    const needle = search.trim().toLowerCase();
    return rows
      .map((role) => {
        const slug = String(role.slug);
        return {
          canCreateOwn: role.canCreateOwn === true,
          description: typeof role.description === "string" ? role.description : "",
          itemId: typeof role.itemId === "string" ? role.itemId : slug,
          name: typeof role.name === "string" ? role.name : slug,
          parentRoleSlug: typeof role.parentRoleSlug === "string" ? role.parentRoleSlug : null,
          permissionCount: typeof role.count === "number" ? role.count : undefined,
          raw: role,
          slug
        } satisfies RoleRow;
      })
      .filter((role) =>
        !needle
        || `${role.name} ${role.slug} ${role.description}`.toLowerCase().includes(needle)
      );
  }, [query.data, search]);

  // slug → row over the LOADED set; the hierarchy column resolves a parent
  // slug to the parent role's display name with it (falls back to the raw
  // slug when the parent isn't in the loaded page, e.g. mid-search).
  const bySlug = useMemo(() => new Map(roles.map((role) => [role.slug, role])), [roles]);

  return { ...query, bySlug, roles };
}

/** The permissions a role currently holds — the pre-checked set in the role
 *  permission editor. NOTE: when this fails to load the editor must block
 *  saving entirely (an empty check-state would blind-clear the role). */
export function useRoleHeldPermissions(slug: string | undefined) {
  const { status: authStatus } = useAuth();
  const query = useQuery({
    enabled: authStatus === "authenticated" && Boolean(slug),
    queryFn: () => listRolePermissions(slug as string),
    queryKey: ["iam", "permissions", "for-role", slug ?? ""],
    retry: false,
    staleTime: 60_000
  });

  const permissions = useMemo<PermissionOption[]>(
    () => (query.data?.data ?? []).map((perm) => permissionOption(perm as Record<string, unknown>)).filter((perm): perm is PermissionOption => Boolean(perm)),
    [query.data]
  );

  return { ...query, permissions };
}

export function usePermissionCatalog() {
  const query = usePermissions();
  // byId lets the diagnosis view resolve dependentPermissions to names.
  const byId = useMemo(() => new Map(query.permissions.map((perm) => [perm.itemId, perm])), [query.permissions]);
  const byResource = useMemo(() => new Map(query.permissions.map((perm) => [perm.resource, perm])), [query.permissions]);
  return { ...query, byId, byResource };
}
