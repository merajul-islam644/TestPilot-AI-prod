import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";
import { useMyOrganizations } from "../../features/organizations/useOrganizationsAdmin";
import { switchOrganization } from "../../lib/blocks/auth";
import { useT } from "../../lib/i18n/LocalizationProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

/** Topbar org switcher. Visible once the user's organizations resolve --
 *  with a single org it doubles as the "which workspace am I in" chip,
 *  with several it switches the session. Switching re-issues the session
 *  for the chosen org (IAM reads the refresh token from its cookie), so
 *  every cached IAM query is dropped and claims refetched afterwards;
 *  otherwise the UI would keep showing the old org's data. */
export function OrgSwitcher() {
  const { claims, refresh } = useAuth();
  const { t } = useT();
  const queryClient = useQueryClient();
  const myOrgs = useMyOrganizations();
  const [switching, setSwitching] = useState(false);
  const activeOrgId = typeof claims?.org_id === "string" ? (claims.org_id as string) : "";
  // Normally claims.org_id names the active org; when the claim is absent
  // a lone membership is the active one by definition.
  const activeOrg =
    myOrgs.organizations.find((org) => org.itemId === activeOrgId) ??
    (myOrgs.organizations.length === 1 ? myOrgs.organizations[0] : undefined);

  async function switchTo(orgId: string, orgName: string) {
    if (switching || orgId === activeOrgId) return;
    setSwitching(true);
    try {
      await switchOrganization(orgId);
      queryClient.clear();
      await refresh();
      toast(`${t("shell.orgSwitched")} ${orgName}`);
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  // A failed/empty membership read hides the chip -- a broken read must
  // never block the topbar, and there is nothing to switch without one.
  if (myOrgs.isError || (!myOrgs.isLoading && myOrgs.organizations.length === 0)) return null;

  const label = activeOrg?.name || activeOrg?.itemId || "…";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={t("shell.orgSwitcher")} className="org-switcher" disabled={switching} title={label} type="button">
          <Building2 size={16} />
          <span>{myOrgs.isLoading ? "…" : label}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>{t("shell.orgSwitcher")}</DropdownMenuLabel>
        {myOrgs.organizations.map((org) => (
          <DropdownMenuItem disabled={switching} key={org.itemId} onSelect={() => void switchTo(org.itemId, org.name || org.itemId)}>
            <Building2 size={16} /> {org.name || org.itemId}
            {org.itemId === activeOrg?.itemId ? <Check size={15} style={{ marginLeft: "auto", color: "hsl(var(--muted-foreground))" }} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
