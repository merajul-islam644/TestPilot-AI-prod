import { CornerDownRight, KeyRound, Pencil, Plus, RefreshCw, Search, ShieldQuestion } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ActionButton } from "../../shared/ui/ActionButton";
import { DataTable, type Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { RequirePermission } from "../../shared/ui/RequirePermission";
import { Diagnose403Modal, CreateRoleModal, EditRoleModal, RolePermissionsModal } from "./RoleDialogs";
import { useRolesPage, type RoleRow } from "./useRolesAdmin";

const MUTATE_ROLES = "blocks-iam::iam::mutate-roles";

export function RolesPage() {
  const { t } = useT();
  // The write gate — IAM's "Manage Roles" permission covers create/update/
  // assign-permissions; RequirePermission hides those controls when it's
  // missing. The read side is enforced by the API itself (a missing
  // roles.list permission 403s and the banner below explains it).

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const roles = useRolesPage(search);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleRow | undefined>();
  const [editingPermissions, setEditingPermissions] = useState<RoleRow | undefined>();
  const [diagnosing, setDiagnosing] = useState<string>(); // role slug to preselect

  const columns = useMemo<Column<RoleRow>[]>(() => [
    {
      header: t("roles.colName"),
      key: "name",
      render: (role) => (
        <span className="user-name">
          <span className="user-name-text">{role.name}</span>
          <span className="chip">{role.slug}</span>
        </span>
      )
    },
    { header: t("roles.colDescription"), key: "description", render: (role) => <span className="muted">{role.description || "—"}</span> },
    {
      header: t("roles.colPermissions"),
      key: "permissions",
      render: (role) => (role.permissionCount !== undefined ? String(role.permissionCount) : "—")
    },
    {
      // One hierarchy cell instead of the old always-dash pair (parent role +
      // assignable): names the parent role when there is one, says
      // "Top-level" otherwise, and chips the sub-role capability.
      header: t("roles.colAssignable"),
      key: "hierarchy",
      render: (role) => {
        const parent = role.parentRoleSlug ? (roles.bySlug.get(role.parentRoleSlug) ?? undefined) : undefined;
        return (
          <span className="role-hierarchy">
            {parent ? (
              <>
                <CornerDownRight aria-hidden size={13} />
                <span className="user-name-text">{parent.name}</span>
              </>
            ) : (
              <span className="muted">{t("roles.topLevel")}</span>
            )}
            {role.canCreateOwn ? <span className="chip">{t("roles.canCreateOwn")}</span> : null}
          </span>
        );
      }
    },
    {
      align: "end",
      header: t("common.actions"),
      key: "actions",
      render: (role) => (
        <span className="row-actions">
          <ActionButton icon={<ShieldQuestion size={15} />} onClick={() => setDiagnosing(role.slug)} title={t("roles.diagnoseAction")} variant="icon" />
          <RequirePermission permission={MUTATE_ROLES}>
            <ActionButton icon={<KeyRound size={15} />} onClick={() => setEditingPermissions(role)} title={t("roles.permissionsAction")} variant="icon" />
            <ActionButton icon={<Pencil size={15} />} onClick={() => setEditing(role)} title={t("roles.editAction")} variant="icon" />
          </RequirePermission>
        </span>
      )
    }
  ], [t, roles.bySlug]);

  return (
    <section>
      <PageHeader
        actions={(
          <>
            <ActionButton icon={<RefreshCw size={18} />} onClick={() => void roles.refetch()} title={t("common.refresh")} variant="icon" />
            <RequirePermission fallback={(
              <span className="field-hint" title={t("roles.mutateDeniedTitle")}>{t("roles.mutateDenied")}</span>
            )} permission={MUTATE_ROLES}>
              <button className="primary-button" onClick={() => setCreating(true)}>
                <Plus size={16} /> {t("roles.createButton")}
              </button>
            </RequirePermission>
          </>
        )}
        subtitle={t("roles.subtitle")}
        title={t("roles.title")}
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setSearchInput(event.target.value)} placeholder={t("roles.searchPlaceholder")} value={searchInput} />
        </label>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={() => setDiagnosing(roles.roles[0]?.slug)} type="button">
            <ShieldQuestion size={15} /> {t("roles.diagnoseAction")}
          </button>
        </div>
      </div>

      {roles.roles.length === 0 && !roles.isLoading ? (
        <EmptyState description={t("roles.emptyDescription")} title={search ? t("roles.emptyFiltered") : t("roles.empty")} />
      ) : (
        <DataTable columns={columns} loading={roles.isLoading} rows={roles.roles} />
      )}

      {roles.isError ? (
        <p className="load-error-banner" role="alert" style={{ marginTop: 12 }}>
          {t("roles.listUnavailable")}
          <button className="link-button" onClick={() => void roles.refetch()} type="button">{t("common.retry")}</button>
        </p>
      ) : null}

      {creating ? (
        <CreateRoleModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void roles.refetch();
          }}
        />
      ) : null}

      {editing ? (
        <EditRoleModal
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void roles.refetch();
          }}
          role={editing}
        />
      ) : null}

      {editingPermissions ? (
        <RolePermissionsModal
          onClose={() => setEditingPermissions(undefined)}
          onSaved={() => {
            setEditingPermissions(undefined);
            void roles.refetch();
          }}
          role={editingPermissions}
        />
      ) : null}

      {diagnosing ? (
        <Diagnose403Modal
          initialRoleSlug={diagnosing}
          onClose={() => setDiagnosing(undefined)}
          onOpenEditor={(role) => {
            setDiagnosing(undefined);
            setEditingPermissions(role);
          }}
          roles={roles.roles}
        />
      ) : null}
    </section>
  );
}
