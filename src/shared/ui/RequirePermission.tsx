import type { ReactNode } from "react";
import { useHasPermission } from "../../features/access/usePermission";

// Hides a control unless the signed-in user holds the permission slug.
// While iam.me() is still loading the verdict is unknown — nothing renders,
// so a permitted admin never sees their buttons flash off and on.
// This is UI only: the API gateway re-checks every Endpoint permission.
export function RequirePermission({
  children,
  fallback = null,
  permission
}: {
  children: ReactNode;
  fallback?: ReactNode;
  permission: string;
}) {
  const has = useHasPermission(permission);
  if (has === undefined) return null;
  return has ? <>{children}</> : <>{fallback}</>;
}
