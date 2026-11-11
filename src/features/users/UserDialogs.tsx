import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { activateUser, createUser, revokeUserAccess, updateUser, updateUserAccess } from "../../lib/blocks/iamUsers";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { ChipList } from "../../shared/ui/Chip";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Modal } from "../../shared/ui/Modal";
import { Select } from "../../shared/ui/select";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useEmailAvailable, usePermissions, useUserDetail, userRoleSlugs, type UserRow } from "./useUsers";

export type RoleOption = { name: string; slug: string };
export type OrgOption = { id: string; name: string };

// --- Invite ------------------------------------------------------------------

/** Create/invite a user. The duplicate-email check runs as the admin types:
 *  a registered address disables the submit before IAM ever has to refuse
 *  it. Roles/org are optional — omitted fields just stay unset. */
export function InviteUserModal({ assignableRoles, defaultOrgId, onClose, onInvited, organizations }: {
  assignableRoles: RoleOption[];
  defaultOrgId: string;
  onClose: () => void;
  onInvited: () => void;
  organizations: OrgOption[];
}) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState(defaultOrgId && organizations.some((org) => org.id === defaultOrgId) ? defaultOrgId : "");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const availability = useEmailAvailable(email);
  const emailTaken = availability.data === false;

  function toggleRole(slug: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || emailTaken) return;
    setError(undefined);
    setPending(true);
    try {
      // Sparse payload: only fields the admin actually filled. An empty
      // password leaves IAM to drive activation through the invite email.
      await createUser({
        email: email.trim(),
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        ...(password ? { password } : {}),
        ...(checked.size > 0 ? { roles: assignableRoles.filter((role) => checked.has(role.slug)).map((role) => role.slug) } : {}),
        ...(orgId ? { organizationId: orgId } : {})
      });
      toast(t("users.inviteDone"));
      onInvited();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("users.inviteTitle")}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("users.inviteSubtitle")}</p>
        <label className="form-field">
          <span>{t("common.email")} <span className="req">*</span></span>
          <input autoComplete="off" autoFocus onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          {availability.isFetching && email.trim() !== "" ? <span className="field-hint">{t("users.emailChecking")}</span> : null}
          {!availability.isFetching && emailTaken ? <span className="field-hint is-error">{t("users.emailTaken")}</span> : null}
          {!availability.isFetching && availability.data === true ? <span className="field-hint is-good">{t("users.emailFree")}</span> : null}
        </label>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label className="form-field">
            <span>{t("profile.firstName")}</span>
            <input onChange={(event) => setFirstName(event.target.value)} type="text" value={firstName} />
          </label>
          <label className="form-field">
            <span>{t("profile.lastName")}</span>
            <input onChange={(event) => setLastName(event.target.value)} type="text" value={lastName} />
          </label>
        </div>
        <label className="form-field">
          <span>{t("users.passwordOptional")}</span>
          <input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          <span className="field-hint">{t("users.passwordHint")}</span>
        </label>
        {assignableRoles.length > 0 ? (
          <div>
            <p className="identity-group-label">{t("users.rolesOptional")}</p>
            <div className="role-picker">
              {assignableRoles.map((role) => (
                <label className="role-option" key={role.slug}>
                  <input checked={checked.has(role.slug)} onChange={() => toggleRole(role.slug)} type="checkbox" />
                  <span>{role.name || role.slug}</span>
                  {role.name ? <code className="muted role-slug">{role.slug}</code> : null}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        {organizations.length > 0 ? (
          <label className="form-field">
            <span>{t("users.orgOptional")}</span>
            <Select
              ariaLabel={t("users.orgOptional")}
              className="w-full"
              items={[{ value: "", label: t("users.orgActiveContext") }, ...organizations.map((org) => ({ value: org.id, label: org.name }))]}
              onChange={setOrgId}
              value={orgId}
            />
          </label>
        ) : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="primary-button" disabled={pending || emailTaken} type="submit">
            {pending ? t("common.loading") : t("users.inviteSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Edit --------------------------------------------------------------------

/** Edit profile fields only — IAM's user-update endpoint is a sparse patch
 *  that ignores roles/permissions (those go through the Access dialog), and
 *  the email itself is the immutable identity field. */
export function EditUserModal({ onClose, onSaved, user }: { onClose: () => void; onSaved: () => void; user: UserRow }) {
  const { t } = useT();
  const [firstName, setFirstName] = useState(typeof user.firstName === "string" ? user.firstName : "");
  const [lastName, setLastName] = useState(typeof user.lastName === "string" ? user.lastName : "");
  const [phone, setPhone] = useState(typeof user.phoneNumber === "string" ? user.phoneNumber : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(undefined);
    setPending(true);
    try {
      // Sent even when emptied: "" is the documented way to clear a field
      // under the sparse-patch contract.
      await updateUser(user.itemId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(phone.trim() ? { phoneNumber: phone.trim() } : {})
      });
      toast(t("users.editDone"));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("users.editTitle")}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="form-field">
          <span>{t("common.email")}</span>
          <input disabled value={typeof user.email === "string" ? user.email : ""} />
          <span className="field-hint">{t("users.emailFixed")}</span>
        </label>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label className="form-field">
            <span>{t("profile.firstName")}</span>
            <input autoFocus onChange={(event) => setFirstName(event.target.value)} type="text" value={firstName} />
          </label>
          <label className="form-field">
            <span>{t("profile.lastName")}</span>
            <input onChange={(event) => setLastName(event.target.value)} type="text" value={lastName} />
          </label>
        </div>
        <label className="form-field">
          <span>{t("users.phone")}</span>
          <input onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? t("common.loading") : t("users.editSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Activate ----------------------------------------------------------------

/** Reactivate a deactivated account. IAM REQUIRES a reason (400 without
 *  one) — the submit stays disabled until the admin writes one. */
export function ActivateUserModal({ onClose, onDone, user }: { onClose: () => void; onDone: () => void; user: UserRow }) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || reason.trim() === "") return;
    setError(undefined);
    setPending(true);
    try {
      await activateUser(user.itemId, reason.trim());
      toast(t("users.activated"));
      onDone();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("users.activateTitle")}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {typeof user.email === "string" ? user.email : user.itemId}
        </p>
        <label className="form-field">
          <span>{t("users.activateReason")} <span className="req">*</span></span>
          <textarea autoFocus onChange={(event) => setReason(event.target.value)} required rows={3} value={reason} />
          <span className="field-hint">{t("users.activateReasonHint")}</span>
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="primary-button" disabled={pending || reason.trim() === ""} type="submit">
            {pending ? t("common.loading") : t("users.activateSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Access ------------------------------------------------------------------

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set(a).size === new Set(b).size && a.every((item) => b.includes(item));

/** Grant/change/revoke a user's access in one organization. The checkbox list
 *  starts from the user's CURRENT roles for that org (loaded via the single
 *  get) — saving REPLACES the org's role list with exactly what ends up
 *  checked, so the dialog shows the union, not a "add roles" half-truth.
 *  Roles outside the assignable set stay locked (shown, always kept). */
export function AccessModal({ assignableRoles, defaultOrgId, onClose, onSaved, organizations, user }: {
  assignableRoles: RoleOption[];
  defaultOrgId: string;
  onClose: () => void;
  onSaved: () => void;
  organizations: OrgOption[];
  user: UserRow;
}) {
  const { t } = useT();
  const orgItems = useMemo(() => {
    const items = organizations.map((org) => ({ value: org.id, label: org.name }));
    if (defaultOrgId && !organizations.some((org) => org.id === defaultOrgId)) {
      items.unshift({ value: defaultOrgId, label: defaultOrgId });
    }
    return items;
  }, [defaultOrgId, organizations]);

  const [orgId, setOrgId] = useState(defaultOrgId);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Permissions: primary input is the searchable picker; the free-text slug
  // field only returns when the permission list itself fails to load.
  const [permChecked, setPermChecked] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState("");
  const [permsText, setPermsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const detail = useUserDetail(user.itemId, orgId || undefined);
  const permissionList = usePermissions();
  // Roles arrive either flat or org-keyed — the helper picks the org's list
  // when the selected organization matches a key.
  const currentRoles = useMemo(() => userRoleSlugs(detail.data?.data, orgId || undefined), [detail.data, orgId]);
  const currentPermissions = useMemo(
    () => (Array.isArray(detail.data?.data?.permissions) ? (detail.data?.data?.permissions as unknown[]).filter((perm): perm is string => typeof perm === "string") : []),
    [detail.data]
  );
  const permissionsFallback = permissionList.isError;

  // Re-sync the checkboxes from the fetched record — when the org switches,
  // after a save-refetch, and on first load. Roles AND permissions both
  // start from the user's current set: the save is a replacement, so the
  // dialog must show the full target state, not just additions.
  useEffect(() => {
    if (!detail.isSuccess) return;
    const assignableSlugs = new Set(assignableRoles.map((role) => role.slug));
    setChecked(new Set(currentRoles.filter((role) => assignableSlugs.has(role))));
    if (!permissionsFallback) setPermChecked(new Set(currentPermissions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignableRoles, currentPermissions, currentRoles, detail.isSuccess, permissionsFallback]);

  const assignableSlugs = useMemo(() => new Set(assignableRoles.map((role) => role.slug)), [assignableRoles]);
  const lockedRoles = currentRoles.filter((role) => !assignableSlugs.has(role));
  const nextRoles = useMemo(
    () => [...lockedRoles, ...assignableRoles.filter((role) => checked.has(role.slug)).map((role) => role.slug)],
    [assignableRoles, checked, lockedRoles]
  );

  // The picker's search filters client-side over the loaded definitions.
  const filteredPermissions = useMemo(() => {
    const needle = permSearch.trim().toLowerCase();
    if (!needle) return permissionList.permissions;
    return permissionList.permissions.filter((perm) =>
      `${perm.slug} ${perm.name} ${perm.resource} ${perm.description}`.toLowerCase().includes(needle)
    );
  }, [permSearch, permissionList.permissions]);

  const permsArray = permsText.split(",").map((slug) => slug.trim()).filter((slug) => slug !== "");
  const permissionsPayload = permissionsFallback ? permsArray : [...permChecked];
  const rolesChanged = !sameSet(nextRoles, currentRoles);
  // Picker mode: the payload IS the target set, so "changed" means it differs
  // from the fetched current set (pre-checked on load). Fallback mode can't
  // see the current set — only ever add, never pretend to replace.
  const permissionsChanged = permissionsFallback ? permsArray.length > 0 : !sameSet(permissionsPayload, currentPermissions);
  const removingAllRoles = nextRoles.length === 0 && currentRoles.length > 0 && lockedRoles.length === 0;

  async function handleSave() {
    if (saving || removingAllRoles || (!rolesChanged && !permissionsChanged)) return;
    setError(undefined);
    setSaving(true);
    try {
      await updateUserAccess({
        userId: user.itemId,
        ...(orgId ? { organizationId: orgId } : {}),
        roles: nextRoles,
        // The fetched record SHOWS the current direct permissions (they ride
        // on users.get), so the picker starts pre-checked and the payload is
        // a fully visible replacement — including an intentional empty list
        // (everything unchecked = clear the direct set). Fallback mode stays
        // add-only: without the current list an empty array could blind-clear.
        ...(permissionsChanged ? { permissions: permissionsPayload } : {})
      });
      toast(t("users.accessUpdated"));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    if (saving) return;
    setConfirmRevoke(false);
    setError(undefined);
    setSaving(true);
    try {
      await revokeUserAccess({ userId: user.itemId, ...(orgId ? { organizationId: orgId } : {}) });
      toast(t("users.accessRevoked"));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("users.accessTitle")}>
      <div style={{ display: "grid", gap: 12 }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {typeof user.email === "string" ? user.email : user.itemId}
        </p>

        <label className="form-field">
          <span>{t("users.accessOrg")}</span>
          <Select
            ariaLabel={t("users.accessOrg")}
            className="w-full"
            items={orgItems.length > 0 ? orgItems : [{ value: defaultOrgId, label: defaultOrgId }]}
            onChange={(next) => {
              setOrgId(next);
              setPermChecked(new Set());
              setPermsText("");
            }}
            value={orgId}
          />
        </label>

        <div className="panel access-current">
          <div className="panel-title"><span>{t("users.accessCurrent")}</span></div>
          {detail.isLoading ? <Skeleton className="skeleton-line" /> : (
            <>
              <p className="identity-group-label">{t("profile.roles")}</p>
              <ChipList empty={t("profile.noRoles")} items={currentRoles} />
              <p className="identity-group-label">{t("profile.permissions")}</p>
              <ChipList empty={t("profile.noPermissions")} items={currentPermissions} />
            </>
          )}
          {detail.isError ? (
            <Alert tone="error">
              {t("users.accessUnavailable")}
              <button className="link-button" onClick={() => void detail.refetch()} type="button">{t("common.retry")}</button>
            </Alert>
          ) : null}
        </div>

        {lockedRoles.length > 0 ? (
          <Alert tone="info">{t("users.accessLockedRoles")} <ChipList empty="" items={lockedRoles} /></Alert>
        ) : null}

        {assignableRoles.length > 0 ? (
          <div>
            <p className="identity-group-label">{t("users.accessRoles")}</p>
            <div className="role-picker">
              {assignableRoles.map((role) => (
                <label className="role-option" key={role.slug}>
                  <input
                    checked={checked.has(role.slug)}
                    onChange={() => setChecked((current) => {
                      const next = new Set(current);
                      if (next.has(role.slug)) next.delete(role.slug);
                      else next.add(role.slug);
                      return next;
                    })}
                    type="checkbox"
                  />
                  <span>{role.name || role.slug}</span>
                  {role.name ? <code className="muted role-slug">{role.slug}</code> : null}
                </label>
              ))}
            </div>
            <span className="field-hint">{t("users.accessRolesHint")}</span>
            {removingAllRoles ? <span className="field-hint is-error">{t("users.accessAllRolesRemoved")}</span> : null}
          </div>
        ) : (
          <label className="form-field">
            <span>{t("users.accessRolesText")}</span>
            <input onChange={(event) => setChecked(new Set(event.target.value.split(",").map((slug) => slug.trim()).filter((slug) => slug !== "")))} type="text" value={[...checked].join(", ")} />
            <span className="field-hint">{t("users.rolesUnavailable")}</span>
          </label>
        )}

        {!permissionsFallback ? (
          <div>
            <p className="identity-group-label">{t("users.accessPermissions")}</p>
            <label className="search-box permission-search">
              <Search size={14} />
              <input onChange={(event) => setPermSearch(event.target.value)} placeholder={t("users.accessPermissionsSearch")} value={permSearch} />
            </label>
            <div className="role-picker" style={{ marginTop: 6 }}>
              {filteredPermissions.map((perm) => (
                <label className="role-option" key={perm.itemId} title={perm.description || perm.slug}>
                  <input
                    checked={permChecked.has(perm.slug)}
                    onChange={() => setPermChecked((current) => {
                      const next = new Set(current);
                      if (next.has(perm.slug)) next.delete(perm.slug);
                      else next.add(perm.slug);
                      return next;
                    })}
                    type="checkbox"
                  />
                  <span>{perm.name || perm.slug}</span>
                  <code className="muted role-slug permission-slug" title={perm.slug}>{perm.slug}</code>
                </label>
              ))}
              {filteredPermissions.length === 0 ? <span className="muted permission-empty">{t("common.notFound")}</span> : null}
            </div>
            <span className="field-hint">{t("users.accessPermissionsHint")}</span>
          </div>
        ) : (
          <label className="form-field">
            <span>{t("users.accessPermissions")}</span>
            <input onChange={(event) => setPermsText(event.target.value)} type="text" value={permsText} />
            <span className="field-hint">{t("users.permissionsUnavailable")}</span>
          </label>
        )}

        <div className="modal-actions">
          <button className="danger-button" disabled={saving} onClick={() => setConfirmRevoke(true)} type="button">
            {t("users.accessRevoke")}
          </button>
          <span style={{ flex: 1 }} />
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button
            className="primary-button"
            disabled={saving || removingAllRoles || (!rolesChanged && !permissionsChanged)}
            onClick={() => void handleSave()}
            title={!rolesChanged && !permissionsChanged ? t("users.accessNoChanges") : undefined}
            type="button"
          >
            {saving ? t("common.loading") : t("users.accessSave")}
          </button>
        </div>
      </div>

      {confirmRevoke ? (
        <ConfirmDialog
          confirmLabel={t("users.accessRevoke")}
          message={t("users.accessRevokeMessage")}
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => void handleRevoke()}
          title={t("users.accessRevokeTitle")}
        />
      ) : null}
    </Modal>
  );
}
