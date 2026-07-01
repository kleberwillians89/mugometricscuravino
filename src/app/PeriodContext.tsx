/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { buildMonthRange, countSelectedPeriodDays, getSelectedPeriodRange } from "./periodRange";

type Period = {
  start: string;
  end: string;
};

type PeriodContextValue = {
  period: Period;
  periodDays: number;
  setPeriod: (next: Period) => void;
  setPresetPeriod: (days: number) => void;
  setCurrentMonthPeriod: () => void;
  setMonthPeriod: (year: number, month: number) => void;
};

const STORAGE_KEY = "mugo.period";

function toDateInput(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeDate(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function calendarParts(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function shiftedMonthPeriod(start: string, end: string): Period | null {
  const startParts = calendarParts(start);
  const endParts = calendarParts(end);
  if (!startParts || !endParts) return null;
  if (startParts.day === 1 || endParts.day !== 1) return null;
  const expectedMonth = startParts.month === 12 ? 1 : startParts.month + 1;
  const expectedYear = startParts.month === 12 ? startParts.year + 1 : startParts.year;
  if (endParts.month !== expectedMonth || endParts.year !== expectedYear) return null;
  const range = buildMonthRange(startParts.year, startParts.month);
  return { start: range.start, end: range.end };
}

function defaultPeriod(days = 30): Period {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return {
    start: toDateInput(start),
    end: toDateInput(end),
  };
}

function currentMonthPeriod(): Period {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return {
    start: toDateInput(start),
    end: toDateInput(end),
  };
}

function fixedMonthPeriod(year: number, month: number): Period {
  const range = buildMonthRange(year, month);
  return { start: range.start, end: range.end };
}

function readStoredPeriod(): Period {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPeriod();
    const parsed = JSON.parse(raw) as Partial<Period>;
    const start = String(parsed.start || "").trim();
    const end = String(parsed.end || "").trim();
    if (!safeDate(start) || !safeDate(end)) return defaultPeriod();
    const normalizedShiftedMonth = shiftedMonthPeriod(start, end);
    if (normalizedShiftedMonth) return normalizedShiftedMonth;
    return { start, end };
  } catch {
    return defaultPeriod();
  }
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<Period>(() => readStoredPeriod());

  const setPeriod = useCallback((next: Period) => {
    const start = String(next.start || "").trim();
    const end = String(next.end || "").trim();
    const startDate = safeDate(start);
    const endDate = safeDate(end);
    if (!startDate || !endDate) return;

    const normalizedStart = startDate <= endDate ? start : end;
    const normalizedEnd = startDate <= endDate ? end : start;

    const normalized: Period = {
      start: normalizedStart,
      end: normalizedEnd,
    };
    setPeriodState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // no-op
    }
  }, []);

  const setPresetPeriod = useCallback(
    (days: number) => {
      const safeDays = Math.max(1, Math.floor(days || 1));
      setPeriod(defaultPeriod(safeDays));
    },
    [setPeriod]
  );

  const setCurrentMonthPeriod = useCallback(() => {
    setPeriod(currentMonthPeriod());
  }, [setPeriod]);

  const setMonthPeriod = useCallback(
    (year: number, month: number) => {
      setPeriod(fixedMonthPeriod(year, month));
    },
    [setPeriod]
  );

  const periodDays = useMemo(
    () => countSelectedPeriodDays(getSelectedPeriodRange(period)),
    [period.end, period.start]
  );

  const value = useMemo<PeriodContextValue>(
    () => ({
      period,
      periodDays,
      setPeriod,
      setPresetPeriod,
      setCurrentMonthPeriod,
      setMonthPeriod,
    }),
    [period, periodDays, setPeriod, setPresetPeriod, setCurrentMonthPeriod, setMonthPeriod]
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    throw new Error("usePeriod precisa ser usado dentro de PeriodProvider.");
  }
  return ctx;
}

export type { Period };
