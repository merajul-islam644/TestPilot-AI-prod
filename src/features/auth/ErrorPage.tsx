import { AlertTriangle, Home } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";

export function ErrorPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { t } = useT();
  return (
    <section className="empty-page">
      <AlertTriangle size={42} />
      <h2>{t("common.error")}</h2>
      <p>The page could not finish loading. Try again or return home.</p>
      <button className="primary-button" onClick={() => onNavigate?.("/")}>
        <Home size={16} /> {t("notFound.home")}
      </button>
    </section>
  );
}
