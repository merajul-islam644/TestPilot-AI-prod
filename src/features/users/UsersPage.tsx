import { Pencil, Plus, RefreshCw, Search, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../app/providers/AuthProvider";
import { useCurrentUser } from "../profile/useCurrentUser";
import { deactivateUser } from "../../lib/blocks/iamUsers";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { DataTable, type Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/select";
import { StatusPill } from "../../shared/ui/StatusPill";
import { AccessModal, ActivateUserModal, EditUserModal, InviteUserModal } from "./UserDialogs";
import { useAssignableRoles, useOrganizations, useRoles, useUsersPage, userRoleSlugs, type UserRow } from "./useUsers";
import { RequirePermission } from "../../shared/ui/RequirePermission";

const PAGE_SIZES = [10, 20, 50];

export function UsersPage() {
  const { t } = useT();
  const { claims } = useAuth();
  const me = useCurrentUser();
  const myId = me.data?.data?.itemId;
  // The admin's active organization context — the access dialog defaults to
  // it, and IAM scopes its single-get (and the access write) to the same.
  const activeOrgId = typeof claims?.org_id === "string" ? (claims.org_id as string) : "";

  // --- List state: server-side paging + filtering (list is a POST read).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  // Debounce the search box so typing doesn't fire a POST per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Any filter/size change restarts paging.
  useEffect(() => {
    setPage(1);
  }, [orgFilter, pageSize, roleFilter, search, statusFilter]);

  const users = useUsersPage({ orgFilter, pageNo: page, pageSize, roleFilter, search, statusFilter });
  const roles = useRoles();
  const organizations = useOrganizations();
  const assignable = useAssignableRoles();

  const rows: UserRow[] = useMemo(
    () => (users.data?.data ?? []).filter((user): user is UserRow => typeof user.itemId === "string" && user.itemId !== ""),
    [users.data]
  );

  // The status filter is server-verified (filter.status), but this IAM
  // deployment ignores the text term (`query`/`search` both return the full
  // list), so the visible rows are filtered client-side too — over the
  // current page, on top of whatever the server applied. Status and role
  // re-checks are redundant when the server honored them, harmless when not.
  const visibleRows = useMemo(() => rows.filter((user) => {
    const needle = search.trim().toLowerCase();
    if (needle) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ").toLowerCase();
      const email = typeof user.email === "string" ? user.email.toLowerCase() : "";
      if (!name.includes(needle) && !email.includes(needle)) return false;
    }
    if (statusFilter === "active" && user.active === false) return false;
    if (statusFilter === "inactive" && user.active !== false) return false;
    if (roleFilter && !userRoleSlugs(user).includes(roleFilter)) return false;
    return true;
  }), [roleFilter, rows, search, statusFilter]);

  const totalCount = typeof users.data?.totalCount === "number" ? users.data.totalCount : undefined;
  const totalPages = totalCount !== undefined ? Math.max(1, Math.ceil(totalCount / pageSize)) : undefined;
  const canGoNext = totalPages !== undefined ? page < totalPages : rows.length === pageSize;
  const hasFilters = Boolean(search || statusFilter || roleFilter || orgFilter);

  // --- Dialog state. Each is a specific user (or "new" for the invite).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | undefined>();
  const [activating, setActivating] = useState<UserRow | undefined>();
  const [managingAccess, setManagingAccess] = useState<UserRow | undefined>();
  const [deactivating, setDeactivating] = useState<UserRow | undefined>();
  const [deactivatePending, setDeactivatePending] = useState(false);

  async function confirmDeactivate() {
    if (!deactivating || deactivatePending) return;
    setDeactivatePending(true);
    try {
      await deactivateUser(deactivating.itemId);
      toast(t("users.deactivated"));
      setDeactivating(undefined);
      await users.refetch();
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setDeactivatePending(false);
    }
  }

  const columns = useMemo<Column<UserRow>[]>(() => [
    {
      header: t("users.colName"),
      key: "name",
      render: (user) => (
        <span className="user-name">
          {[user.firstName, user.lastName].filter(Boolean).join(" ") || (typeof user.email === "string" ? user.email : user.itemId)}
          {user.itemId === myId ? <span className="chip">{t("users.you")}</span> : null}
        </span>
      )
    },
    { header: t("users.colEmail"), key: "email", render: (user) => <span className="muted">{typeof user.email === "string" ? user.email : "—"}</span> },
    {
      header: t("users.colRoles"),
      key: "roles",
      render: (user) => {
        const userRoles = userRoleSlugs(user);
        if (userRoles.length === 0) return <span className="muted">—</span>;
        return (
          <span className="chips">
            {userRoles.slice(0, 2).map((role) => <span className="chip" key={role}>{role}</span>)}
            {userRoles.length > 2 ? <span className="muted">+{userRoles.length - 2}</span> : null}
          </span>
        );
      }
    },
    {
      header: t("common.status"),
      key: "status",
      render: (user) => (
        <StatusPill tone={user.active === false ? "warn" : "good"}>
          {user.active === false ? t("users.statusInactive") : t("users.statusActive")}
        </StatusPill>
      )
    },
    {
      align: "end",
      header: t("common.actions"),
      key: "actions",
      render: (user) => (
        // Every action here is an IAM user mutation — one gate covers all of
        // them ("Manage Users", blocks-iam::iam::mutate-users). Read-only page
        // access is enforced server-side on the list call itself.
        <RequirePermission permission="blocks-iam::iam::mutate-users">
          <span className="row-actions" onClick={(event) => event.stopPropagation()}>
            <ActionButton icon={<ShieldCheck size={15} />} onClick={() => setManagingAccess(user)} title={t("users.accessAction")} variant="icon" />
            <ActionButton icon={<Pencil size={15} />} onClick={() => setEditing(user)} title={t("users.editAction")} variant="icon" />
            {user.active === false ? (
              <ActionButton icon={<UserCheck size={15} />} onClick={() => setActivating(user)} title={t("users.activateAction")} variant="icon" />
            ) : (
              // Deactivating yourself would lock you out mid-session — keep the
              // button off your own row; another admin can do it.
              user.itemId === myId ? null : (
                <ActionButton icon={<UserX size={15} />} onClick={() => setDeactivating(user)} title={t("users.deactivateAction")} variant="icon" />
              )
            )}
          </span>
        </RequirePermission>
      )
    }
  ], [myId, t]);

  return (
    <section>
      <PageHeader
        actions={(
          <>
            <ActionButton icon={<RefreshCw size={18} />} onClick={() => void users.refetch()} title={t("common.refresh")} variant="icon" />
            <RequirePermission permission="blocks-iam::iam::mutate-users">
              <button className="primary-button" onClick={() => setInviteOpen(true)}>
                <Plus size={16} /> {t("users.invite")}
              </button>
            </RequirePermission>
          </>
        )}
        subtitle={t("users.subtitle")}
        title={t("users.title")}
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setSearchInput(event.target.value)} placeholder={t("users.searchPlaceholder")} value={searchInput} />
        </label>
        <div className="toolbar-actions">
          <Select
            ariaLabel={t("users.filterStatus")}
            items={[
              { value: "", label: t("users.filterStatus") },
              { value: "active", label: t("users.statusActive") },
              { value: "inactive", label: t("users.statusInactive") }
            ]}
            onChange={setStatusFilter}
            value={statusFilter}
          />
          <Select
            ariaLabel={t("users.filterRole")}
            items={[{ value: "", label: t("users.filterRole") }, ...roles.roles.map((role) => ({ value: role.slug, label: role.name || role.slug }))]}
            onChange={setRoleFilter}
            value={roleFilter}
          />
          <Select
            ariaLabel={t("users.filterOrg")}
            items={[{ value: "", label: t("users.filterOrg") }, ...organizations.organizations.map((org) => ({ value: org.id, label: org.name }))]}
            onChange={setOrgFilter}
            value={orgFilter}
          />
          <Select
            ariaLabel={t("users.pageSize")}
            items={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}` }))}
            onChange={(value) => setPageSize(Number(value))}
            value={String(pageSize)}
          />
        </div>
      </div>

      {rows.length === 0 && !hasFilters && !users.isLoading ? (
        <EmptyState
          action={(
            <RequirePermission permission="blocks-iam::iam::mutate-users">
              <button className="primary-button" onClick={() => setInviteOpen(true)}>
                <Plus size={16} /> {t("users.invite")}
              </button>
            </RequirePermission>
          )}
          description={t("users.subtitle")}
          title={t("users.empty")}
        />
      ) : visibleRows.length === 0 && hasFilters && !users.isLoading ? (
        <EmptyState description={t("common.notFound")} title={t("users.emptyFiltered")} />
      ) : (
        <>
          <DataTable columns={columns} loading={users.isLoading} onRowClick={(user) => setManagingAccess(user)} rows={visibleRows} />
          <div className="pagination">
            <span className="pagination-count">
              {totalCount !== undefined
                ? hasFilters && visibleRows.length !== totalCount
                  ? `${visibleRows.length} / ${totalCount} ${t("users.countUsers")}`
                  : `${totalCount} ${t("users.countUsers")}`
                : ""}
            </span>
            <div className="pagination-controls">
              <button
                className="secondary-button"
                disabled={page <= 1 || users.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                {t("users.prevPage")}
              </button>
              <span>
                {t("users.page")} {page}
                {totalPages !== undefined ? ` ${t("users.of")} ${totalPages}` : ""}
              </span>
              <button
                className="secondary-button"
                disabled={!canGoNext || users.isFetching}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                {t("users.nextPage")}
              </button>
            </div>
          </div>
        </>
      )}

      {users.isError ? (
        <p className="load-error-banner" role="alert" style={{ marginTop: 12 }}>
          {t("users.listUnavailable")}
          <button className="link-button" onClick={() => void users.refetch()} type="button">{t("common.retry")}</button>
        </p>
      ) : null}

      {inviteOpen ? (
        <InviteUserModal
          assignableRoles={assignable.roles}
          defaultOrgId={activeOrgId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false);
            void users.refetch();
          }}
          organizations={organizations.organizations}
        />
      ) : null}

      {editing ? (
        <EditUserModal
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void users.refetch();
          }}
          user={editing}
        />
      ) : null}

      {activating ? (
        <ActivateUserModal
          onClose={() => setActivating(undefined)}
          onDone={() => {
            setActivating(undefined);
            void users.refetch();
          }}
          user={activating}
        />
      ) : null}

      {managingAccess ? (
        <AccessModal
          assignableRoles={assignable.roles}
          defaultOrgId={activeOrgId}
          onClose={() => setManagingAccess(undefined)}
          onSaved={() => {
            setManagingAccess(undefined);
            void users.refetch();
          }}
          organizations={organizations.organizations}
          user={managingAccess}
        />
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          confirmLabel={t("users.deactivateConfirm")}
          message={t("users.deactivateMessage")}
          onCancel={() => setDeactivating(undefined)}
          onConfirm={() => void confirmDeactivate()}
          title={t("users.deactivateTitle")}
        />
      ) : null}
    </section>
  );
}
