import type { LucideIcon } from "lucide-react";
import { Bug, ChartColumn, FolderKanban, Layers, LayoutDashboard, LifeBuoy, ListChecks, Settings, Users } from "lucide-react";
import type { TranslationKey } from "../../lib/i18n/dictionary";

export type NavItem = { href: string; icon: LucideIcon; labelKey: TranslationKey };

export const primaryNavItems: NavItem[] = [
  { href: "/", icon: LayoutDashboard, labelKey: "nav.overview" },
  { href: "/projects", icon: FolderKanban, labelKey: "nav.projects" },
  { href: "/runs", icon: ListChecks, labelKey: "nav.runs" },
  { href: "/suites", icon: Layers, labelKey: "nav.suites" },
  { href: "/issues", icon: Bug, labelKey: "nav.issues" },
  { href: "/reports", icon: ChartColumn, labelKey: "nav.reports" }
];

export const secondaryNavItems: NavItem[] = [
  { href: "/users", icon: Users, labelKey: "nav.users" },
  { href: "/settings", icon: Settings, labelKey: "nav.settings" },
  { href: "/help", icon: LifeBuoy, labelKey: "nav.help" }
];

/** The workspace section a detail page (e.g. /runs/run-042) belongs to. */
export function navSectionForPath(path: string): NavItem | undefined {
  return [...primaryNavItems, ...secondaryNavItems].find((item) =>
    item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`)
  );
}
