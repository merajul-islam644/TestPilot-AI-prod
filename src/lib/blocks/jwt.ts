export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Invalid JWT: missing payload");

  const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function jwtExpiryMs(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
}

export function isJwtExpired(token: string, skewMs = 30_000): boolean {
  let expiry: number | undefined;
  try {
    expiry = jwtExpiryMs(token);
  } catch {
    return true;
  }
  if (!expiry) return false;
  return Date.now() + skewMs >= expiry;
}
