import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { useCurrentUser } from "../profile/useCurrentUser";
import { listBackupCodes, readMfaConfig } from "../../lib/blocks/mfa";

// Read-side hooks for the Security settings section. The tenant-policy read
// needs `blocks-iam::iam::mfa-configs` — an ordinary user gets a 403, so
// useTenantMfaConfig exposes `isError` and the UI degrades to a note instead
// of an error state. Enrollment state comes from iam.me(), which every
// signed-in user can read about themselves.

/** The signed-in user's own MFA state off iam.me(). `enabled` is the truth —
 *  `userMfaType` can be set while MFA is still off, so never treat the method
 *  number alone as "enrolled". */
export function useMyMfaStatus() {
  const me = useCurrentUser();
  return useMemo(() => {
    const record = (me.data?.data ?? {}) as Record<string, unknown>;
    return {
      enabled: record.mfaEnabled === true,
      itemId: typeof record.itemId === "string" ? record.itemId : "",
      method: typeof record.userMfaType === "number" ? record.userMfaType : 0,
      ready: me.isSuccess,
      verified: record.isMfaVerified === true,
      refetch: me.refetch
    };
  }, [me.data, me.isSuccess, me.refetch]);
}

export type TenantMfaPolicy = {
  allowBackupCodes: boolean;
  allowOptOut: boolean;
  backupCodesCount: number;
  enabled: boolean;
  /** Method names IAM reports on read (e.g. ["TOTP","Email"]) — reads give
   *  names, writes take the UserMfaType integers. */
  allowedMethodNames: string[];
  exemptRoles: string[];
  requiredRoles: string[];
  requireForAll: boolean;
};

const METHOD_BY_NAME: [RegExp, number][] = [
  [/totp/i, 1],
  [/email/i, 2],
  [/sms|text/i, 3],
  [/whats/i, 4]
];

/** Maps an allowed-method display name to the UserMfaType integer for writes.
 *  Unknown names return undefined — the caller drops them rather than guessing. */
export function mfaTypeFromName(name: string): number | undefined {
  const hit = METHOD_BY_NAME.find(([pattern]) => pattern.test(name));
  return hit?.[1];
}

export function parseMfaPolicy(record: Record<string, unknown>): TenantMfaPolicy {
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    allowBackupCodes: record.allowBackupCodes === true,
    allowOptOut: record.allowUserOptOut === true,
    backupCodesCount: typeof record.backupCodesCount === "number" ? record.backupCodesCount : 0,
    enabled: record.enabled === true,
    allowedMethodNames: list(record.allowedMethods),
    exemptRoles: list(record.mfaExemptRoles),
    requiredRoles: list(record.mfaRequiredRoles),
    requireForAll: record.requireMfaForAllUsers === true
  };
}

export function useTenantMfaConfig() {
  const { status } = useAuth();
  const query = useQuery({
    enabled: status === "authenticated",
    queryFn: readMfaConfig,
    // A 403 here is an expected state (user without the policy permission),
    // not a flaky failure — don't retry it.
    queryKey: ["iam", "mfa", "config"],
    retry: false,
    staleTime: 60_000
  });

  const policy = useMemo<TenantMfaPolicy | undefined>(
    () => (query.data ? parseMfaPolicy(query.data) : undefined),
    [query.data]
  );

  return { ...query, policy };
}

/** Unused backup-code count. Fails cleanly when the user isn't enrolled
 *  (`mfa_not_enrolled`) — the UI hides the backup-code card in that case. */
export function useBackupCodesRemaining() {
  const { status } = useAuth();
  return useQuery({
    enabled: status === "authenticated",
    queryFn: listBackupCodes,
    queryKey: ["iam", "mfa", "backup-codes"],
    retry: false,
    staleTime: 30_000
  });
}

export function backupCodesRemaining(query: { data?: Record<string, unknown> }): number | undefined {
  const payload = (query.data ?? {}) as Record<string, unknown>;
  const value = payload.remaining ?? payload.remainingCount ?? payload.count;
  return typeof value === "number" ? value : undefined;
}
