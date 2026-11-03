import { Moon, Sun } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useTheme } from "../providers/ThemeProvider";

/** Quick light/dark flip in the topbar; System is the default from Settings. */
export function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const { t } = useT();

  return (
    <button
      aria-label={resolved === "dark" ? t("shell.themeLight") : t("shell.themeDark")}
      className="icon-button"
      onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
      title={resolved === "dark" ? t("shell.themeLight") : t("shell.themeDark")}
    >
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
