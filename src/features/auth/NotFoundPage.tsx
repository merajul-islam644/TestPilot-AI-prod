import { Home } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";

export function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  return (
    <section className="not-found">
      <h2>{t("notFound.title")}</h2>
      <p>{t("notFound.message")}</p>
      <button
        className="primary-button"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("/");
        }}
      >
        <Home size={16} /> {t("notFound.home")}
      </button>
    </section>
  );
}
