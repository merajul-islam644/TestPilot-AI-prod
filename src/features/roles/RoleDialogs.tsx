import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { assignRolePermissions, createRole, updateRole } from "../../lib/blocks/iamRoles";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Modal } from "../../shared/ui/Modal";
import { Select } from "../../shared/ui/select";
import { Skeleton } from "../../shared/ui/Skeleton";
import { usePermissionCatalog, useRoleHeldPermissions, type RoleRow } from "./useRolesAdmin";
import type { PermissionOption } from "../users/useUsers";

export type RoleOption = { name: string; slug: string };

// --- Role admin dialogs -------------------------------------------------------
// Every mutation here follows the access-control discipline: the admin builds
// the change in the form, sees an exact summary of what will change, and only
// an explicit confirm click sends anything to IAM.

/** Endpoint-vs-frontend filter values for the permission pickers. */
const TYPE_FILTERS = [
  { value: "", labelKey: "roles.typeAll" },
  { value: "1", labelKey: "roles.typeEndpoint" },
  { value: "2", labelKey: "roles.typeFrontend" }
] as const;

function filterCatalog(catalog: PermissionOption[], search: string, typeFilter: string): PermissionOption[] {
  const needle = search.trim().toLowerCase();
  return catalog.filter((perm) => {
    if (typeFilter && String(perm.type) !== typeFilter) return false;
    if (needle && !`${perm.slug} ${perm.name} ${perm.resource} ${perm.description}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

function TypeSelect({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const { t } = useT();
  return (
    <Select
      ariaLabel={t("roles.typeFilter")}
      items={TYPE_FILTERS.map(({ labelKey, value: itemValue }) => ({ label: t(labelKey), value: itemValue }))}
      onChange={onChange}
      value={value}
    />
  );
}

/** One dependency gap: the permission being added needs `dep`, which isn't
 *  among the role's held set or the new additions. Resolves the resource
 *  string to a human name when the catalog knows it. */
function missingDependencyNames(option: PermissionOption, coveredResources: Set<string>, catalog: PermissionOption[]): string[] {
  const byResource = new Map(catalog.map((perm) => [perm.resource, perm]));
  return option.dependentPermissions
    .filter((dep) => !coveredResources.has(dep))
    .map((dep) => {
      const known = byResource.get(dep);
      return known ? known.name || dep : dep;
    });
}

// --- Create ------------------------------------------------------------------

export function CreateRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  const trimmed = { description: description.trim(), name: name.trim(), slug: slug.trim() };
  const canSubmit = Boolean(trimmed.name) && !pending;

  async function handleConfirm() {
    if (!canSubmit) return;
    setConfirming(false);
    setError(undefined);
    setPending(true);
    try {
      await createRole({
        description: trimmed.description,
        name: trimmed.name,
        // Omitted slug lets IAM derive it from the name; an explicit one must
        // be unique — IAM's own error surfaces otherwise.
        ...(trimmed.slug ? { slug: trimmed.slug } : {})
      });
      toast(t("roles.created"));
      onCreated();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("roles.createTitle")}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="form-field">
          <span>{t("roles.fieldName")}</span>
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label className="form-field">
          <span>{t("roles.fieldSlug")}</span>
          <input onChange={(event) => setSlug(event.target.value)} placeholder={t("roles.fieldSlugHint")} value={slug} />
        </label>
        <label className="form-field">
          <span>{t("roles.fieldDescription")}</span>
          <textarea onChange={(event) => setDescription(event.target.value)} rows={2} value={description} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="primary-button" disabled={!canSubmit} type="submit">
            {t("roles.createButton")}
          </button>
        </div>
      </form>
      {confirming ? (
        <ConfirmDialog
          confirmLabel={t("roles.createConfirmLabel")}
          message={`${t("roles.createConfirmMessage")} "${trimmed.name}"${trimmed.slug ? ` (${trimmed.slug})` : ""}${trimmed.description ? ` — ${trimmed.description}` : ""}`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void handleConfirm()}
          title={t("roles.createConfirmTitle")}
        />
      ) : null}
    </Modal>
  );
}

// --- Edit definition ----------------------------------------------------------

export function EditRoleModal({ onClose, onSaved, role }: { onClose: () => void; onSaved: () => void; role: RoleRow }) {
  const { t } = useT();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  const changed = name.trim() !== role.name || description.trim() !== role.description;
  const changedSummary = [
    name.trim() !== role.name ? `${role.name} → ${name.trim()}` : "",
    description.trim() !== role.description ? `${role.description || "—"} → ${description.trim() || "—"}` : ""
  ].filter(Boolean).join("; ");

  async function handleConfirm() {
    if (!changed || pending) return;
    setConfirming(false);
    setError(undefined);
    setPending(true);
    try {
      // roles.update REPLACES the record — send the documented fields back in
      // full (parent + canCreateOwn untouched) so nothing else is cleared.
      await updateRole({
        canCreateOwn: role.canCreateOwn,
        description: description.trim(),
        itemId: role.itemId,
        name: name.trim(),
        parentRoleSlug: role.parentRoleSlug,
        slug: role.slug
      });
      toast(t("roles.saved"));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("roles.editTitle")}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (changed) setConfirming(true); }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="form-field">
          <span>{t("roles.fieldSlug")}</span>
          <input disabled value={role.slug} />
          <small className="field-hint">{t("roles.slugLocked")}</small>
        </label>
        <label className="form-field">
          <span>{t("roles.fieldName")}</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="form-field">
          <span>{t("roles.fieldDescription")}</span>
          <textarea onChange={(event) => setDescription(event.target.value)} rows={2} value={description} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="primary-button" disabled={!changed || pending} type="submit">
            {t("common.save")}
          </button>
        </div>
      </form>
      {confirming ? (
        <ConfirmDialog
          confirmLabel={t("roles.editConfirmLabel")}
          message={`${t("roles.editConfirmMessage")} "${role.slug}": ${changedSummary}`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void handleConfirm()}
          title={t("roles.editConfirmTitle")}
        />
      ) : null}
    </Modal>
  );
}

// --- Permission editor ---------------------------------------------------------

export function RolePermissionsModal({ onClose, onSaved, role }: { onClose: () => void; onSaved: () => void; role: RoleRow }) {
  const { t } = useT();
  const held = useRoleHeldPermissions(role.slug);
  const catalog = usePermissionCatalog();

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  const heldIds = useMemo(() => new Set(held.permissions.map((perm) => perm.itemId)), [held.permissions]);
  const heldFailed = held.isError;

  // Pre-check the role's current set once it loads; the save is a visible
  // delta (adds/removes), never a blind replace.
  useEffect(() => {
    if (held.isSuccess) setChecked(new Set(heldIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held.isSuccess, heldIds]);

  const adds = useMemo(() => [...checked].filter((id) => !heldIds.has(id)), [checked, heldIds]);
  const removes = useMemo(() => [...heldIds].filter((id) => !checked.has(id)), [checked, heldIds]);
  const changed = adds.length > 0 || removes.length > 0;
  const noChanges = !changed;

  const filtered = useMemo(() => filterCatalog(catalog.permissions, permSearch, typeFilter), [catalog.permissions, permSearch, typeFilter]);

  // For each newly added permission, list dependencies not covered by the
  // role's held set or by the additions themselves — those would 403 anyway.
  const dependencyGaps = useMemo(() => {
    const addedResources = new Set(adds.map((id) => catalog.byId.get(id)?.resource).filter((resource): resource is string => Boolean(resource)));
    const covered = new Set([...held.permissions.map((perm) => perm.resource), ...addedResources]);
    return adds
      .map((id) => {
        const option = catalog.byId.get(id);
        if (!option) return undefined;
        const missing = missingDependencyNames(option, covered, catalog.permissions);
        return missing.length > 0 ? { missing, option } : undefined;
      })
      .filter((entry): entry is { missing: string[]; option: PermissionOption } => Boolean(entry));
  }, [adds, catalog, held.permissions]);

  const addNames = adds.map((id) => catalog.byId.get(id)?.name || catalog.byId.get(id)?.resource || id);
  const removeNames = removes.map((id) => held.permissions.find((perm) => perm.itemId === id)?.name || id);

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!changed || pending || heldFailed) return;
    setConfirming(false);
    setError(undefined);
    setPending(true);
    try {
      // Delta only — assignPermissions is additive/subtractive; itemIds are
      // the values IAM expects here (the CLI resolves slugs to ids for us).
      await assignRolePermissions({
        addPermissions: adds,
        removePermissions: removes,
        slug: role.slug
      });
      toast(t("roles.permissionsSaved"));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  const confirmLines = [
    adds.length > 0 ? `${t("roles.applyAdds")} ${addNames.join(", ")}` : "",
    removes.length > 0 ? `${t("roles.applyRemoves")} ${removeNames.join(", ")}` : ""
  ].filter(Boolean).join(" • ");

  return (
    <Modal onClose={onClose} title={`${t("roles.permissionsTitle")} — ${role.name}`}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {heldFailed ? <Alert tone="warn">{t("roles.holdFailed")}</Alert> : null}
      {held.isLoading && !heldFailed ? <Skeleton /> : (
        <>
          <p className="field-hint">{t("roles.permissionsHint")}</p>
          <div className="toolbar permission-toolbar">
            <label className="search-box permission-search">
              <Search size={15} />
              <input onChange={(event) => setPermSearch(event.target.value)} placeholder={t("roles.permissionsSearch")} value={permSearch} />
            </label>
            <TypeSelect onChange={setTypeFilter} value={typeFilter} />
          </div>
          {dependencyGaps.length > 0 ? (
            <Alert tone="warn">
              {t("roles.dependencyWarning")}
              <ul>
                {dependencyGaps.map(({ missing, option }) => (
                  <li key={option.itemId}>
                    <strong>{option.name || option.resource}</strong> → {missing.join(", ")}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div className="role-picker permission-picker">
            {filtered.length === 0 ? (
              <p className="permission-empty">{t("roles.permissionsEmpty")}</p>
            ) : filtered.map((perm) => (
              <label
                className="role-option"
                key={perm.itemId}
                title={`${perm.description}${perm.dependentPermissions.length > 0 ? `\n${t("roles.dependsOn")}: ${perm.dependentPermissions.join(", ")}` : ""}`}
              >
                <input checked={checked.has(perm.itemId)} onChange={() => toggle(perm.itemId)} type="checkbox" />
                <span>{perm.name || perm.slug}</span>
                <code className="muted role-slug permission-slug" title={perm.slug}>{perm.slug}</code>
              </label>
            ))}
          </div>
          <p className="field-hint">
            {t("roles.selectedCount").replace("{held}", String(heldIds.size)).replace("{checked}", String(checked.size))}
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
            <button className="primary-button" disabled={!changed || pending || heldFailed} onClick={() => setConfirming(true)} type="button">
              {t("roles.savePermissions")}
            </button>
          </div>
        </>
      )}
      {confirming && changed ? (
        <ConfirmDialog
          confirmLabel={t("roles.applyConfirmLabel")}
          message={confirmLines}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void handleConfirm()}
          title={`${t("roles.applyConfirmTitle")} "${role.slug}"`}
        />
      ) : null}
    </Modal>
  );
}

// --- 403 diagnosis --------------------------------------------------------------

export function Diagnose403Modal({ initialRoleSlug, onClose, onOpenEditor, roles }: {
  initialRoleSlug?: string;
  onClose: () => void;
  onOpenEditor: (role: RoleRow) => void;
  roles: RoleRow[];
}) {
  const { t } = useT();
  const catalog = usePermissionCatalog();
  const [roleSlug, setRoleSlug] = useState(initialRoleSlug ?? roles[0]?.slug ?? "");
  const [keyword, setKeyword] = useState("");

  const selected = roles.find((role) => role.slug === roleSlug);
  const held = useRoleHeldPermissions(roleSlug || undefined);
  const heldIds = useMemo(() => new Set(held.permissions.map((perm) => perm.itemId)), [held.permissions]);
  const heldFailed = held.isError;

  const needle = keyword.trim().toLowerCase();
  const endpoints = useMemo(() => {
    if (needle.length < 2) return [];
    return catalog.permissions.filter((perm) =>
      perm.type === 1 && `${perm.slug} ${perm.name} ${perm.resource} ${perm.description}`.toLowerCase().includes(needle)
    );
  }, [catalog.permissions, needle]);

  return (
    <Modal onClose={onClose} title={t("roles.diagnoseTitle")}>
      {heldFailed ? <Alert tone="warn">{t("roles.holdFailed")}</Alert> : null}
      <p className="field-hint">{t("roles.diagnoseIntro")}</p>
      <div className="toolbar permission-toolbar">
        <Select
          ariaLabel={t("roles.diagnoseRole")}
          items={roles.map((role) => ({ label: role.name || role.slug, value: role.slug }))}
          onChange={setRoleSlug}
          value={roleSlug}
        />
        <label className="search-box permission-search">
          <Search size={15} />
          <input onChange={(event) => setKeyword(event.target.value)} placeholder={t("roles.diagnoseKeyword")} value={keyword} />
        </label>
      </div>
      {needle.length < 2 ? (
        <p className="permission-empty">{t("roles.diagnoseHint")}</p>
      ) : endpoints.length === 0 ? (
        <p className="permission-empty">{t("roles.diagnoseEmpty")}</p>
      ) : (
        <div className="diagnosis-list">
          {endpoints.map((perm) => {
            const isHeld = heldIds.has(perm.itemId);
            const covered = new Set([...held.permissions.map((entry) => entry.resource), perm.resource]);
            const gaps = isHeld ? [] : missingDependencyNames(perm, covered, catalog.permissions);
            return (
              <div className="diagnosis-row" key={perm.itemId}>
                <div className="diagnosis-main">
                  <span>{perm.name || perm.slug}</span>
                  <code className="muted role-slug permission-slug" title={perm.slug}>{perm.slug}</code>
                </div>
                <div className="diagnosis-side">
                  {heldFailed ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={`chip${isHeld ? " diagnosis-held" : " diagnosis-missing"}`}>
                      {isHeld ? t("roles.diagnoseHeld") : t("roles.diagnoseMissing")}
                    </span>
                  )}
                  {!isHeld && !heldFailed && gaps.length > 0 ? (
                    <span className="muted diagnosis-deps">{t("roles.dependsOn")}: {gaps.join(", ")}</span>
                  ) : null}
                  {!isHeld && !heldFailed && selected ? (
                    <button className="link-button" onClick={() => onOpenEditor(selected)} type="button">
                      {t("roles.diagnoseOpenEditor")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
