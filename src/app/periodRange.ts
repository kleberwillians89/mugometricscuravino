type PeriodLike = {
  start: string;
  end: string;
};

export type SelectedPeriodRange = Pick<PeriodLike, "start" | "end">;
export type CalendarMonthRange = SelectedPeriodRange & {
  start_inclusive: string;
  end_exclusive: string;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
  value: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function clampYear(value: number): number {
  return Math.max(2000, Math.min(2100, Math.floor(value || 0)));
}

function clampMonth(value: number): number {
  return Math.max(1, Math.min(12, Math.floor(value || 1)));
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return {
    year,
    month,
    day,
    value: formatCalendarDate(year, month, day),
  };
}

function nextMonthStart(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return formatCalendarDate(nextYear, nextMonth, 1);
}

function daysFromCivil(year: number, month: number, day: number): number {
  let y = year;
  const m = month;
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = m + (m > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function buildMonthRange(year: number, month: number): CalendarMonthRange {
  const safeYear = clampYear(year);
  const safeMonth = clampMonth(month);
  const start = formatCalendarDate(safeYear, safeMonth, 1);
  const end = formatCalendarDate(safeYear, safeMonth, daysInMonth(safeYear, safeMonth));
  const start_inclusive = `${start}T00:00:00`;
  const end_exclusive = `${nextMonthStart(safeYear, safeMonth)}T00:00:00`;
  console.log("[period-builder]", {
    selected_month: `${safeYear}-${pad2(safeMonth)}`,
    start,
    end,
    start_inclusive,
    end_exclusive,
  });
  return {
    start,
    end,
    start_inclusive,
    end_exclusive,
  };
}

function fallbackPeriod(days = 30): SelectedPeriodRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (Math.max(1, Math.floor(days || 30)) - 1));
  return {
    start: toDateInput(start),
    end: toDateInput(end),
  };
}

function fixedMonthRange(month?: number | null, year?: number | null): SelectedPeriodRange | null {
  if (!month || !year) return null;
  return buildMonthRange(year, month);
}

export function getSelectedPeriodRange(
  period?: Partial<PeriodLike> | null,
  month?: number | null,
  year?: number | null
): SelectedPeriodRange {
  const start = parseCalendarDate(period?.start);
  const end = parseCalendarDate(period?.end);
  if (start && end) {
    return start.value <= end.value
      ? { start: start.value, end: end.value }
      : { start: end.value, end: start.value };
  }

  return fixedMonthRange(month, year) || fallbackPeriod();
}

export function countSelectedPeriodDays(range: SelectedPeriodRange): number {
  const selected = getSelectedPeriodRange(range);
  const start = parseCalendarDate(selected.start);
  const end = parseCalendarDate(selected.end);
  if (!start || !end) return 30;
  return Math.max(
    1,
    daysFromCivil(end.year, end.month, end.day) - daysFromCivil(start.year, start.month, start.day) + 1
  );
}

export function formatSelectedPeriodLabel(range: SelectedPeriodRange): string {
  const selected = getSelectedPeriodRange(range);
  const format = (value: string) => {
    const parsed = parseCalendarDate(value);
    if (!parsed) return value;
    return `${pad2(parsed.day)}/${pad2(parsed.month)}/${parsed.year}`;
  };
  return `${format(selected.start)}–${format(selected.end)}`;
}
