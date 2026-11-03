// Formatting helpers shared by pages, tables and charts. Everything is
// deliberately locale-simple ("en-US") so dates and numbers stay stable
// between the LanguageSwitcher's tenant languages and the UI copy.

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** 75 -> "1m 15s", 42 -> "42s", 3_600 -> "1h 00m" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms / 1000);
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return formatDate(timestamp);
}

export type HealthTone = "healthy" | "attention" | "critical";

export function healthFromRate(rate: number): { tone: HealthTone; labelKey: "health.healthy" | "health.attention" | "health.critical" } {
  if (rate >= 95) return { tone: "healthy", labelKey: "health.healthy" };
  if (rate >= 90) return { tone: "attention", labelKey: "health.attention" };
  return { tone: "critical", labelKey: "health.critical" };
}

export function healthDotClass(tone: HealthTone): string {
  return tone === "healthy" ? "ok" : tone === "attention" ? "warn" : "bad";
}

/** CSS class for a delta given its direction and which direction is good. */
export function deltaClass(direction: "up" | "down" | "flat", upIsGood: boolean): string {
  if (direction === "flat") return "delta-neutral";
  const good = upIsGood ? direction === "up" : direction === "down";
  return good ? "delta-up-good" : "delta-down-bad";
}
