import { Building2, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ChangeEvent } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { DataTable, type Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Modal } from "../../shared/ui/Modal";
import { PageHeader } from "../../shared/ui/PageHeader";
import { RequirePermission } from "../../shared/ui/RequirePermission";
import { Switch } from "../../shared/ui/Switch";
import { createOrganization, saveOrgConfig, saveSignupSettings, updateOrganization } from "../../lib/blocks/organizations";
import { useOrgConfig, useOrgsAdminPage, useSignupSettings, type OrgConfig, type OrgRow, type SignupSettings } from "./useOrganizationsAdmin";

const READ_ORGS = "blocks-iam::iam::organizations";
const WRITE_ORGS = "blocks-iam::iam::mutate-organizations";
const READ_TENANT_CONFIGS = "blocks-iam::iam::tenant-configs";
const WRITE_TENANT_CONFIGS = "blocks-iam::iam::mutate-tenant-configs";

// consentForMultiOrgEnable rides along on save but is a consent record, not
// a toggle — deliberately not rendered as an editable row.
const EDITABLE_FLAGS: (keyof OrgConfig)[] = [
  "isMultiOrgEnabled",
  "isOrgNameUniquenessEnabled",
  "allowOrgCreationFromSignup",
  "allowOrgCreationFromPortal",
  "allowOrgCreationFromCloud",
  "allowOrgCreationFromConstruct"
];

const ORG_FIELDS: { key: keyof OrgFormState; labelKey: TranslationKey }[] = [
  { key: "name", labelKey: "orgs.field.name" },
  { key: "description", labelKey: "orgs.field.description" },
  { key: "email", labelKey: "orgs.field.email" },
  { key: "websiteUrl", labelKey: "orgs.field.website" }
];

type OrgFormState = { description: string; email: string; name: string; websiteUrl: string };

// --- Create / edit organization ------------------------------------------------
// Organizations are a tenant-isolation boundary (blocks-iam-organizations
// skill): the confirm dialog restates every change as old → new before any
// create/update fires. Edit sends ONLY changed fields (partial patch).

function OrgFormModal({ onClose, onSaved, org }: { onClose: () => void; onSaved: () => void; org?: OrgRow }) {
  const { t } = useT();
  const [form, setForm] = useState<OrgFormState>({
    description: org?.description ?? "",
    email: org?.email ?? "",
    name: org?.name ?? "",
    websiteUrl: org?.websiteUrl ?? ""
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (key: keyof OrgFormState) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const changes = useMemo(() => {
    if (!org) return [];
    return ORG_FIELDS
      .map(({ key, labelKey }) => {
        const next = form[key].trim();
        if (next === (org[key] ?? "")) return "";
        return `${t(labelKey)}: ${org[key] || "—"} → ${next || "—"}`;
      })
      .filter(Boolean);
  }, [form, org, t]);

  const changed = !org || changes.length > 0;

  async function save() {
    if (pending) return;
    setPending(true);
    try {
      if (org) {
        const payload: Record<string, unknown> = {};
        ORG_FIELDS.forEach(({ key }) => {
          const next = form[key].trim();
          if (next !== (org[key] ?? "")) payload[key] = next;
        });
        await updateOrganization(org.itemId, payload);
        toast(t("orgs.updated"));
      } else {
        await createOrganization({
          description: form.description.trim() || undefined,
          email: form.email.trim() || undefined,
          name: form.name.trim(),
          websiteUrl: form.websiteUrl.trim() || undefined
        });
        toast(t("orgs.created"));
      }
      onSaved();
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  const createSummary = ORG_FIELDS
    .map(({ key, labelKey }) => {
      const value = form[key].trim();
      return value ? `${t(labelKey)}: ${value}` : "";
    })
    .filter(Boolean)
    .join(" • ");

  return (
    <Modal onClose={onClose} title={org ? t("orgs.editTitle") : t("orgs.createTitle")}>
      {ORG_FIELDS.map(({ key, labelKey }) => (
        <div className="form-field" key={key}>
          <label htmlFor={`org-${key}`}>{t(labelKey)}{key === "name" ? " *" : ""}</label>
          <input
            id={`org-${key}`}
            onChange={set(key)}
            type={key === "email" ? "email" : "text"}
            value={form[key]}
          />
        </div>
      ))}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose} type="button">{t("common.cancel")}</button>
        <button className="primary-button" disabled={!changed || form.name.trim() === "" || pending} onClick={() => setConfirmOpen(true)} type="button">
          {t("common.save")}
        </button>
      </div>
      {confirmOpen ? (
        <ConfirmDialog
          confirmLabel={t("common.save")}
          message={org ? changes.join(" • ") : createSummary}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
          title={org ? t("orgs.confirmEditTitle") : t("orgs.confirmCreateTitle")}
        />
      ) : null}
    </Modal>
  );
}

// --- Shared policy-row layout ---------------------------------------------------

function FlagRow({ hint, label, onChange, value }: { hint: string; label: string; onChange: (next: boolean) => void; value: boolean }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{label}</strong>
        <p>{hint}</p>
      </div>
      <Switch checked={value} label={label} onChange={onChange} />
    </div>
  );
}

// --- Tenant org config (multi-org enablement) ------------------------------------
// Read needs tenant-configs, save needs mutate-tenant-configs. saveConfig
// MERGES server-side, but the body spreads the read value back so the
// confirm is an honest summary of the full resulting policy.

function OrgConfigPanel() {
  const { t } = useT();
  const query = useOrgConfig();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OrgConfig | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // Re-seed the draft whenever a fresh read lands.
  useEffect(() => {
    setDraft(query.config);
  }, [query.config, query.dataUpdatedAt]);

  const raw = (query.data ?? {}) as Record<string, unknown>;
  const saved = query.config;
  const labels: Record<keyof OrgConfig, TranslationKey> = {
    allowOrgCreationFromCloud: "orgs.config.fromCloud",
    allowOrgCreationFromConstruct: "orgs.config.fromConstruct",
    allowOrgCreationFromPortal: "orgs.config.fromPortal",
    allowOrgCreationFromSignup: "orgs.config.fromSignup",
    consentForMultiOrgEnable: "orgs.config.consent",
    isMultiOrgEnabled: "orgs.config.multiOrg",
    isOrgNameUniquenessEnabled: "orgs.config.nameUniqueness"
  };

  const changes = useMemo(() => {
    if (!draft || !saved) return [];
    const onOff = (on: boolean) => (on ? t("common.on") : t("common.off"));
    return (Object.keys(draft) as (keyof OrgConfig)[])
      .filter((key) => draft[key] !== saved[key])
      .map((key) => `${t(labels[key])}: ${onOff(saved[key])} → ${onOff(draft[key])}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saved, t]);

  async function save() {
    if (!draft || pending) return;
    setPending(true);
    try {
      await saveOrgConfig({ ...raw, ...draft });
      toast(t("orgs.config.saved"));
      await queryClient.invalidateQueries({ queryKey: ["iam", "organizations", "config"] });
      await queryClient.invalidateQueries({ queryKey: ["iam", "organizations", "my"] });
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="panel org-policy-panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("orgs.config.title")}</h3>
          <p className="panel-desc">{t("orgs.config.subtitle")}</p>
        </div>
      </div>
      {query.isLoading || (query.isSuccess && !draft) ? (
        <p className="muted">{t("common.loading")}</p>
      ) : query.isError || !query.config || !draft ? (
        <p className="muted">{t("orgs.config.unavailable")}</p>
      ) : (
        <>
          <RequirePermission fallback={<p className="muted">{t("orgs.config.unavailable")}</p>} permission={READ_TENANT_CONFIGS}>
            {EDITABLE_FLAGS.map((key) => (
              <FlagRow
                hint={t(`${labels[key]}Hint` as TranslationKey)}
                key={key}
                label={t(labels[key])}
                onChange={(next) => setDraft((current) => (current ? { ...current, [key]: next } : current))}
                value={draft[key]}
              />
            ))}
            <RequirePermission fallback={<p className="field-hint">{t("orgs.config.readOnly")}</p>} permission={WRITE_TENANT_CONFIGS}>
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                <button className="primary-button" disabled={changes.length === 0 || pending} onClick={() => setConfirmOpen(true)} type="button">
                  {t("common.save")}
                </button>
              </div>
            </RequirePermission>
          </RequirePermission>
          {confirmOpen ? (
            <ConfirmDialog
              confirmLabel={t("common.save")}
              message={changes.join(" • ")}
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => void save()}
              title={t("orgs.config.confirmTitle")}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// --- Signup policy ----------------------------------------------------------------
// The save endpoint stores EXACTLY the four body fields (omitted booleans
// become false, omitted lists empty) — so every save sends all four, with
// default permissions passed through untouched from the read (they are IAM
// item ids, not hand-editable slugs).

function SignupPolicyPanel() {
  const { t } = useT();
  const query = useSignupSettings();
  const queryClient = useQueryClient();
  const settings = query.settings;
  const [emailSignup, setEmailSignup] = useState<boolean | undefined>();
  const [ssoSignup, setSsoSignup] = useState<boolean | undefined>();
  const [rolesText, setRolesText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setEmailSignup(settings.isEmailPasswordSignUpEnabled);
    setSsoSignup(settings.isSSoSignUpEnabled);
    setRolesText(settings.defaultRolesForNewUser.join(", "));
  }, [settings]);

  const rolesFromText = rolesText.split(",").map((entry) => entry.trim()).filter(Boolean);
  const changes = useMemo(() => {
    if (!settings || emailSignup === undefined || ssoSignup === undefined) return [];
    const onOff = (on: boolean) => (on ? t("common.on") : t("common.off"));
    const lines: string[] = [];
    if (emailSignup !== settings.isEmailPasswordSignUpEnabled) {
      lines.push(`${t("orgs.signup.emailSignup")}: ${onOff(settings.isEmailPasswordSignUpEnabled)} → ${onOff(emailSignup)}`);
    }
    if (ssoSignup !== settings.isSSoSignUpEnabled) {
      lines.push(`${t("orgs.signup.ssoSignup")}: ${onOff(settings.isSSoSignUpEnabled)} → ${onOff(ssoSignup)}`);
    }
    if (rolesFromText.join(",") !== settings.defaultRolesForNewUser.join(",")) {
      lines.push(`${t("orgs.signup.defaultRoles")}: ${settings.defaultRolesForNewUser.join(", ") || t("common.none")} → ${rolesFromText.join(", ") || t("common.none")}`);
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailSignup, rolesText, settings, ssoSignup, t]);

  async function save() {
    if (!settings || pending) return;
    setPending(true);
    try {
      await saveSignupSettings({
        defaultPermissionsForNewUserOnSignUp: settings.defaultPermissionsForNewUser,
        defaultRolesForNewUserOnSignUp: rolesFromText,
        isEmailPasswordSignUpEnabled: emailSignup === true,
        isSSoSignUpEnabled: ssoSignup === true
      });
      toast(t("orgs.signup.saved"));
      await queryClient.invalidateQueries({ queryKey: ["iam", "signup-settings"] });
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="panel org-policy-panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("orgs.signup.title")}</h3>
          <p className="panel-desc">{t("orgs.signup.subtitle")}</p>
        </div>
      </div>
      {query.isLoading || (query.isSuccess && !settings) ? (
        <p className="muted">{t("common.loading")}</p>
      ) : query.isError || !settings || emailSignup === undefined || ssoSignup === undefined ? (
        <p className="muted">{t("orgs.signup.unavailable")}</p>
      ) : (
        <>
          <FlagRow hint={t("orgs.signup.emailSignupHint")} label={t("orgs.signup.emailSignup")} onChange={setEmailSignup} value={emailSignup} />
          <FlagRow hint={t("orgs.signup.ssoSignupHint")} label={t("orgs.signup.ssoSignup")} onChange={setSsoSignup} value={ssoSignup} />
          <div className="form-field" style={{ maxWidth: 360 }}>
            <label htmlFor="signup-roles">{t("orgs.signup.defaultRoles")}</label>
            <input id="signup-roles" onChange={(event) => setRolesText(event.target.value)} value={rolesText} />
            <p className="field-hint">{t("orgs.signup.rolesHint")}</p>
          </div>
          <p className="field-hint">{t("orgs.signup.permissionsHint")}</p>
          {!settings.isSignUpEnable ? <Alert tone="warn">{t("orgs.signup.masterOff")}</Alert> : null}
          <RequirePermission fallback={<p className="field-hint">{t("orgs.signup.readOnly")}</p>} permission={WRITE_TENANT_CONFIGS}>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              <button className="primary-button" disabled={changes.length === 0 || pending} onClick={() => setConfirmOpen(true)} type="button">
                {t("common.save")}
              </button>
            </div>
          </RequirePermission>
          {confirmOpen ? (
            <ConfirmDialog
              confirmLabel={t("common.save")}
              message={changes.join(" • ")}
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => void save()}
              title={t("orgs.signup.confirmTitle")}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// --- Page -------------------------------------------------------------------------

export function OrganizationsPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OrgRow | undefined>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const orgs = useOrgsAdminPage(search);

  const columns = useMemo<Column<OrgRow>[]>(() => [
    { header: t("orgs.field.name"), key: "name", render: (org) => <span className="user-name">{org.name || "—"}</span> },
    { header: t("orgs.field.description"), key: "description", render: (org) => <span className="muted">{org.description || "—"}</span> },
    { header: t("orgs.field.email"), key: "email", render: (org) => <span className="muted">{org.email || "—"}</span> },
    { header: t("orgs.field.website"), key: "website", render: (org) => <span className="muted">{org.websiteUrl || "—"}</span> },
    {
      align: "end",
      header: t("common.actions"),
      key: "actions",
      render: (org) => (
        <RequirePermission permission={WRITE_ORGS}>
          <span className="row-actions" onClick={(event) => event.stopPropagation()}>
            <ActionButton icon={<Pencil size={15} />} onClick={() => setEditing(org)} title={t("common.edit")} variant="icon" />
          </span>
        </RequirePermission>
      )
    }
  ], [t]);

  return (
    <section>
      <PageHeader
        actions={(
          <>
            <ActionButton icon={<RefreshCw size={18} />} onClick={() => void orgs.refetch()} title={t("common.refresh")} variant="icon" />
            <RequirePermission fallback={<span className="muted">{t("orgs.createDenied")}</span>} permission={WRITE_ORGS}>
              <button className="primary-button" onClick={() => setCreating(true)}>
                <Plus size={16} /> {t("orgs.create")}
              </button>
            </RequirePermission>
          </>
        )}
        subtitle={t("orgs.subtitle")}
        title={t("orgs.title")}
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setSearchInput(event.target.value)} placeholder={t("orgs.searchPlaceholder")} value={searchInput} />
        </label>
      </div>

      <RequirePermission fallback={<p className="muted">{t("orgs.listDenied")}</p>} permission={READ_ORGS}>
        {orgs.rows.length === 0 && !orgs.isLoading ? (
          <EmptyState
            action={(
              <span className="muted">
                <Building2 size={16} /> {t("orgs.emptyHint")}
              </span>
            )}
            description={t("orgs.subtitle")}
            title={t("orgs.empty")}
          />
        ) : (
          <DataTable columns={columns} loading={orgs.isLoading} onRowClick={(org) => setEditing(org)} rows={orgs.rows} />
        )}
        {orgs.isError ? <Alert tone="error">{t("orgs.listUnavailable")}</Alert> : null}
      </RequirePermission>

      <OrgConfigPanel />
      <SignupPolicyPanel />

      {creating ? (
        <OrgFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ["iam", "organizations"] });
          }}
        />
      ) : null}

      {editing ? (
        <OrgFormModal
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ["iam", "organizations"] });
          }}
          org={editing}
        />
      ) : null}
    </section>
  );
}
