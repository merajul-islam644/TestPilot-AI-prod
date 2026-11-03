import { Bell, CheckCheck } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

// Reference-only shell: Blocks does not expose a notifications API, so this
// renders a real, accessible menu with a static empty state rather than
// faking data against a Blocks endpoint that does not exist.
export function NotificationsMenu() {
  const { t } = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="icon-button" aria-label={t("shell.notifications")}>
        <Bell size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[300px]">
        <DropdownMenuLabel>{t("shell.notifications")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCheck size={22} className="text-[hsl(var(--muted-foreground))]" />
          <p className="text-sm font-medium">{t("shell.caughtUpTitle")}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("shell.caughtUpDesc")}</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
