import { ChevronDown, LifeBuoy, LogOut, Settings, UserRound } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";
import { useAvatar } from "../../features/profile/useAvatar";
import { useCurrentUser, userDisplayName, userInitials } from "../../features/profile/useCurrentUser";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

/** Sidebar-bottom identity block: avatar, name, role, and the account menu. */
export function SidebarUser({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: (path: string) => void }) {
  const { logout } = useAuth();
  const { t } = useT();
  const { avatar } = useAvatar();
  const me = useCurrentUser();
  const profile = me.data?.data;
  const name = userDisplayName(profile) || (me.isLoading ? "…" : t("shell.role"));
  const role = profile?.roles?.[0] ? capitalize(profile.roles[0]) : t("shell.role");
  const initials = userInitials(profile);

  function handleLogout() {
    logout();
    onNavigate("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={name} className="sidebar-user" type="button">
          <UserAvatar initials={initials} size="sm" url={avatar?.url} />
          {collapsed ? null : (
            <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
              <span className="sidebar-user-name">{name}</span>
              <span className="sidebar-user-meta">{role}</span>
            </span>
          )}
          {collapsed ? null : <ChevronDown size={14} style={{ marginLeft: "auto", color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[220px]">
        <DropdownMenuLabel className="flex items-center gap-3 font-normal">
          <UserAvatar initials={initials} size="lg" url={avatar?.url} />
          <div className="grid gap-0.5 overflow-hidden">
            <strong className="truncate text-sm font-semibold">{userDisplayName(profile) || "…"}</strong>
            {profile?.email ? <small className="truncate text-xs text-[hsl(var(--muted-foreground))]">{profile.email}</small> : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigate("/profile")}><UserRound size={16} /> {t("nav.profile")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/settings")}><Settings size={16} /> {t("nav.settings")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/help")}><LifeBuoy size={16} /> {t("nav.help")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={handleLogout}><LogOut size={16} /> {t("nav.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
