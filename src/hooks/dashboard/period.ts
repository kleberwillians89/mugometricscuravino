import type { Period } from "../../app/PeriodContext";

export type DashboardPeriod = Pick<Period, "start" | "end">;

function toDateInput(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDateInput(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  const parsed = new Date(`${text}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

export function fallbackDashboardPeriod(days = 30): DashboardPeriod {
  const safeDays = Math.max(1, Math.floor(days || 30));
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (safeDays - 1));
  return {
    start: toDateInput(start),
    end: toDateInput(end),
  };
}

export function ensureDashboardPeriod(
  period: Partial<DashboardPeriod> | null | undefined
): DashboardPeriod {
  const fallback = fallbackDashboardPeriod(30);
  const start = String(period?.start || "").trim();
  const end = String(period?.end || "").trim();
  if (!isValidDateInput(start) || !isValidDateInput(end)) return fallback;

  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (startDate.getTime() <= endDate.getTime()) return { start, end };
  return { start: end, end: start };
}
