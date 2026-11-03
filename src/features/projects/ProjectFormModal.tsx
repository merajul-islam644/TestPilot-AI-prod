import { useState } from "react";
import { createProject, updateProject } from "../../lib/demo/store";
import type { Project, ProjectIcon } from "../../lib/demo/data";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Modal } from "../../shared/ui/Modal";

const ICON_KEYS: ProjectIcon[] = ["globe", "cart", "phone", "megaphone", "receipt"];
const ICON_LABELS: Record<ProjectIcon, TranslationKey> = {
  cart: "icon.cart",
  globe: "icon.globe",
  megaphone: "icon.megaphone",
  phone: "icon.phone",
  receipt: "icon.receipt"
};

// Create/edit form for projects. The store call is optimistic -- the card
// updates immediately and the gateway write continues in the background.
export function ProjectFormModal({ onClose, project }: { onClose: () => void; project?: Project }) {
  const { t } = useT();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [icon, setIcon] = useState<ProjectIcon>(project?.icon ?? "globe");
  const [tagsText, setTagsText] = useState(project?.tags.join(", ") ?? "");
  const [attempted, setAttempted] = useState(false);

  const valid = name.trim().length > 0;

  function handleSubmit() {
    if (!valid) {
      setAttempted(true);
      return;
    }
    const input = {
      description,
      icon,
      name,
      tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)
    };
    if (project) updateProject(project.id, input);
    else createProject(input);
    onClose();
  }

  return (
    <Modal onClose={onClose} title={t(project ? "projects.editTitle" : "projects.newTitle")}>
      <div className="form-grid">
        <label className="form-field">
          <span>{t("projects.form.name")} <span className="req">*</span></span>
          <input onChange={(event) => setName(event.target.value)} placeholder={t("projects.form.namePlaceholder")} value={name} />
        </label>
        <label className="form-field">
          <span>{t("projects.form.icon")}</span>
          <select onChange={(event) => setIcon(event.target.value as ProjectIcon)} value={icon}>
            {ICON_KEYS.map((key) => (
              <option key={key} value={key}>{t(ICON_LABELS[key])}</option>
            ))}
          </select>
        </label>
        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("projects.form.description")}</span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder={t("projects.form.descriptionPlaceholder")} value={description} />
        </label>
        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("projects.form.tags")}</span>
          <input onChange={(event) => setTagsText(event.target.value)} placeholder={t("projects.form.tagsPlaceholder")} value={tagsText} />
        </label>
        {attempted && !valid ? (
          <p className="field-error" style={{ gridColumn: "1 / -1", margin: 0, color: "hsl(var(--destructive))", fontSize: 13 }}>{t("projects.form.validation")}</p>
        ) : null}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary-button" onClick={handleSubmit}>{t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
