import { blocksClient } from "./client";

// --- MFA: self-service + tenant policy ---------------------------------------
// Thin wrappers over blocksClient.mfa. Every response is an IAM pass-through
// (Record<string, unknown>) — the UI parses fields defensively and renders
// IAM's own errors rather than pre-validating anything.
//
// Discipline (from the blocks-iam-mfa contract): setup/generate/verify and
// backup-code consumption are authentication *protocol steps* — the UI may
// fire them only inside the signed-in user's explicit enrollment flow. The
// config reads/writes are tenant policy and need the mfa-configs /
// mutate-mfa-configs permissions; an ordinary user gets a 403 and the UI
// degrades, it does not surface an error page.

/** IAM's UserMfaType enum. Only 1 (TOTP) and 2 (Email) have a provider in
 *  this tenant — 3 (SMS) and 4 (WhatsApp) exist in the contract but no
 *  delivery gateway is configured, so the UI never offers them. */
export const MFA_TYPE = { NONE: 0, TOTP: 1, EMAIL: 2, SMS: 3, WHATSAPP: 4 } as const;

export function readMfaConfig(): Promise<Record<string, unknown>> {
  return blocksClient.mfa.config();
}

export function saveMfaConfig(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return blocksClient.mfa.saveConfig(request);
}

/** Starts TOTP enrollment — returns the secret/QR payload. Render it, collect
 *  the authenticator's 6-digit code, then call totpVerifySetup. */
export function totpSetup(): Promise<Record<string, unknown>> {
  return blocksClient.mfa.totp.setup();
}

/** Confirms TOTP enrollment; IAM activates TOTP as the user's method on
 *  success (sets MfaEnabled / UserMfaType / IsMfaVerified itself). */
export function totpVerifySetup(code: string): Promise<Record<string, unknown>> {
  return blocksClient.mfa.totp.verifySetup({ code });
}

/** Issues an email/SMS OTP challenge. The returned `mfaId` is required by
 *  resend/verify and cannot be looked up afterwards — keep it in memory. */
export function generateOtp(mfaType: number): Promise<Record<string, unknown>> {
  return blocksClient.mfa.generate({ mfaType });
}

export function resendOtp(mfaId: string): Promise<Record<string, unknown>> {
  return blocksClient.mfa.resend({ mfaId });
}

export function verifyOtp(request: { authType: number; mfaId: string; verificationCode: string }): Promise<Record<string, unknown>> {
  return blocksClient.mfa.verify(request);
}

/** Activates the user's MFA method. ONLY 1/2 are switches — every other value
 *  falls through to IAM's disable path, so callers must pass MFA_TYPE values.
 *  setMethod(2) is also how email-OTP enrollment works (it needs a verified
 *  email; IAM answers `email_not_verified` otherwise). */
export function setMfaMethod(mfaType: number): Promise<Record<string, unknown>> {
  return blocksClient.mfa.setMethod({ mfaType });
}

/** Opt-out. IAM enforces the tenant's allowUserOptOut policy — the UI shows
 *  this action only when it has read the policy and opt-out is allowed. */
export function disableMfa(): Promise<Record<string, unknown>> {
  return blocksClient.mfa.disable();
}

/** How many unused backup codes the user has. Never returns the codes. */
export function listBackupCodes(): Promise<Record<string, unknown>> {
  return blocksClient.mfa.backupCodes.list();
}

/** Fresh backup codes, shown to the user exactly once. Fails with
 *  `backup_codes_disabled` when the tenant policy disallows them and
 *  `mfa_not_enrolled` when the user has no active method. */
export function generateBackupCodes(): Promise<Record<string, unknown>> {
  return blocksClient.mfa.backupCodes.generate();
}

// --- Payload parsing (IAM's setup/QR response shape is not typed) ------------

export type TotpSetupPayload = {
  /** A ready-made QR image (data URI or URL) if IAM returned one. */
  qrImageSrc?: string;
  /** The otpauth:// provisioning URI if IAM returned one. */
  otpauthUri?: string;
  /** The raw secret for manual entry / building the URI ourselves. */
  secret?: string;
  raw: Record<string, unknown>;
};

export function parseTotpSetup(payload: Record<string, unknown>): TotpSetupPayload {
  const raw = payload ?? {};
  let qrImageSrc: string | undefined;
  let otpauthUri: string | undefined;
  let secret: string | undefined;

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value === "") continue;
    const lower = key.toLowerCase();
    if (!otpauthUri && value.startsWith("otpauth://")) otpauthUri = value;
    if (!qrImageSrc && (lower.includes("qr") || lower.includes("barcode") || lower.includes("image")) &&
      (value.startsWith("data:image/") || /^https?:\/\//.test(value))) qrImageSrc = value;
    if (!secret && (lower.includes("secret") || lower === "key" || lower.includes("manualentry"))) secret = value;
  }

  return { otpauthUri, qrImageSrc, secret, raw };
}

/** Builds an otpauth:// URI from a bare secret so the QR generator always has
 *  something to encode, matching what authenticator apps expect. */
export function buildOtpauthUri(secret: string, email: string, issuer = "TestPilot AI"): string {
  const label = encodeURIComponent(`${issuer}:${email || "account"}`);
  const query = new URLSearchParams({ issuer, secret });
  return `otpauth://totp/${label}?${query.toString()}`;
}
