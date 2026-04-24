type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DASH_CACHE = new Map<string, CacheEntry<unknown>>();

export function buildDashboardCacheKey(
  scope: string,
  input: {
    clientId: string;
    connectionId?: string | null;
    start?: string;
    end?: string;
    extra?: string;
  }
): string {
  const client = String(input.clientId || "").trim() || "-";
  const connection = String(input.connectionId || "").trim() || "-";
  const start = String(input.start || "").trim() || "-";
  const end = String(input.end || "").trim() || "-";
  const extra = String(input.extra || "").trim() || "-";
  return `${scope}|c=${client}|k=${connection}|s=${start}|e=${end}|x=${extra}`;
}

export function readDashboardCache<T>(key: string): T | null {
  const entry = DASH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    DASH_CACHE.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeDashboardCache<T>(key: string, value: T, ttlMs = 180_000): void {
  const safeTtl = Math.max(5_000, Math.floor(ttlMs || 180_000));
  DASH_CACHE.set(key, {
    value,
    expiresAt: Date.now() + safeTtl,
  });
}

export function clearDashboardCacheByPrefix(prefix: string): void {
  for (const key of DASH_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      DASH_CACHE.delete(key);
    }
  }
}
