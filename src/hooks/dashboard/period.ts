import type { Period } from "../../app/PeriodContext";
import { getSelectedPeriodRange } from "../../app/periodRange";

export type DashboardPeriod = Pick<Period, "start" | "end">;

export function fallbackDashboardPeriod(days = 30): DashboardPeriod {
  const safeDays = Math.max(1, Math.floor(days || 30));
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (safeDays - 1));
  const toDateInput = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return getSelectedPeriodRange({ start: toDateInput(start), end: toDateInput(end) });
}

export function ensureDashboardPeriod(
  period: Partial<DashboardPeriod> | null | undefined
): DashboardPeriod {
  return getSelectedPeriodRange(period || fallbackDashboardPeriod(30));
}
