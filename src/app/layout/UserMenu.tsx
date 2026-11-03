import { LogOut, Settings, UserRound } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";
import { useCurrentUser, userDisplayName, userInitials } from "../../features/profile/useCurrentUser";
import { useT } from "../../lib/i18n/LocalizationProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

export function UserMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { logout } = useAuth();
  const { t } = useT();
  const me = useCurrentUser();
  const profile = me.data?.data;
  const name = userDisplayName(profile) || (me.isLoading ? "…" : "…");
  const roles = profile?.roles ?? [];

  function handleLogout() {
    logout();
    onNavigate("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="user-menu-trigger" aria-label={t("nav.profile")}>
        <span className="avatar avatar-sm">{userInitials(profile)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        <DropdownMenuLabel className="flex items-center gap-3 font-normal">
          <span className="avatar avatar-lg">{userInitials(profile)}</span>
          <div className="grid gap-0.5 overflow-hidden">
            <strong className="truncate text-sm font-semibold">{name}</strong>
            {profile?.email ? <small className="truncate text-xs text-[hsl(var(--muted-foreground))]">{profile.email}</small> : null}
            {roles.length > 0 ? <small className="truncate text-xs capitalize text-[hsl(var(--muted-foreground))]">{roles.join(", ")}</small> : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigate("/profile")}><UserRound size={16} /> {t("nav.viewProfile")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/settings")}><Settings size={16} /> {t("nav.settings")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={handleLogout}>
          <LogOut size={16} /> {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
