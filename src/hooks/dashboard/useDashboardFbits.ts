import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFbitsOrders, getFbitsOrdersSummary } from "../../app/api";
import type { FbitsOrdersResponse, FbitsOrdersSummaryResponse } from "../../app/types";
import { ensureDashboardPeriod, type DashboardPeriod } from "./period";
import {
  buildDashboardCacheKey,
  readDashboardCache,
  writeDashboardCache,
} from "./cache";

type Params = {
  isAuthenticated: boolean;
  activeClientId: string;
  period?: DashboardPeriod | null;
};

function friendlyError(error: unknown) {
  console.warn("[fbits-dashboard]", error);
  return "A leitura oficial de vendas não ficou disponível agora.";
}

type FbitsCachePayload = {
  summary: FbitsOrdersSummaryResponse | null;
  orders: FbitsOrdersResponse | null;
};

function summarySource(summary: FbitsOrdersSummaryResponse | null | undefined) {
  return String(summary?.source || summary?.debug?.source_used || summary?.debug?.source || "").trim();
}

function isValidSummary(summary: FbitsOrdersSummaryResponse | null | undefined) {
  return Boolean(
    summary &&
      Number(summary.summary?.receita_oficial || 0) > 0 &&
      Number(summary.summary?.pedidos || 0) > 0 &&
      summarySource(summary) !== "fbits_incomplete"
  );
}

function samePeriod(
  summary: FbitsOrdersSummaryResponse | null | undefined,
  start: string,
  end: string
) {
  return summary?.period?.start === start && summary?.period?.end === end;
}

export default function useDashboardFbits({ isAuthenticated, activeClientId, period }: Params) {
  const safePeriod = useMemo(() => ensureDashboardPeriod(period), [period]);
  const rangeKey = useMemo(
    () =>
      buildDashboardCacheKey("fbits", {
        clientId: activeClientId,
        start: safePeriod.start,
        end: safePeriod.end,
      }),
    [activeClientId, safePeriod.end, safePeriod.start]
  );
  const cachedInitial = useMemo(
    () => (activeClientId ? readDashboardCache<FbitsCachePayload>(rangeKey) : null),
    [activeClientId, rangeKey]
  );
  const [fbitsData, setFbitsData] = useState<FbitsOrdersSummaryResponse | null>(
    null
  );
  const [fbitsOrders, setFbitsOrders] = useState<FbitsOrdersResponse | null>(
    cachedInitial?.orders || null
  );
  const [loadingFbits, setLoadingFbits] = useState(false);
  const [fbitsError, setFbitsError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const activeRequestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const latestSummaryRef = useRef<FbitsOrdersSummaryResponse | null>(null);

  useEffect(() => {
    if (cachedInitial) {
      setFbitsData(null);
      latestSummaryRef.current = null;
      setFbitsOrders(cachedInitial.orders);
    }
    setFbitsError(null);
  }, [cachedInitial, rangeKey]);

  const reloadFbits = useCallback(async (options?: { force?: boolean }) => {
    if (!isAuthenticated || !activeClientId) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    activeRequestRef.current = requestId;
    const requestStart = safePeriod.start;
    const requestEnd = safePeriod.end;
    console.log("[google/fbits-dashboard][request]", requestId, requestStart, requestEnd);
    const cached = options?.force ? null : readDashboardCache<FbitsCachePayload>(rangeKey);
    if (cached) {
      setFbitsOrders(cached.orders);
    }
    setLoadingFbits(true);
    setFbitsError(null);
    try {
      const [summary, orders] = await Promise.allSettled([
        getFbitsOrdersSummary({
          start: requestStart,
          end: requestEnd,
        }, {
          signal: controller.signal,
        }),
        getFbitsOrders({
          start: requestStart,
          end: requestEnd,
        }, {
          signal: controller.signal,
        }),
      ]);
      if (requestId !== activeRequestRef.current || controller.signal.aborted) {
        console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd);
        return null;
      }
      if (summary.status === "rejected") throw summary.reason;
      const source = summarySource(summary.value);
      const receita = Number(summary.value.summary?.receita_oficial || 0);
      console.log("[google/fbits-dashboard][response]", requestId, requestStart, requestEnd, source, receita);
      console.log("[google/fbits-dashboard]", summary.value.debug_version, summary.value.debug, summary.value.summary);
      const currentSummary = latestSummaryRef.current;
      if (
        source === "fbits_incomplete" &&
        samePeriod(currentSummary, requestStart, requestEnd) &&
        isValidSummary(currentSummary)
      ) {
        console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd, source);
        return currentSummary;
      }
      if (!samePeriod(summary.value, requestStart, requestEnd)) {
        console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd, "period-mismatch");
        return null;
      }
      latestSummaryRef.current = summary.value;
      setFbitsData(summary.value);
      let nextOrders = cached?.orders || cachedInitial?.orders || null;
      if (orders.status === "fulfilled") {
        if (
          orders.value?.period?.start === requestStart &&
          orders.value?.period?.end === requestEnd
        ) {
          setFbitsOrders(orders.value);
          nextOrders = orders.value;
        } else {
          console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd, "orders-period-mismatch");
        }
      } else {
        console.warn("[fbits-orders]", orders.reason);
      }
      writeDashboardCache<FbitsCachePayload>(
        rangeKey,
        { summary: summary.value, orders: nextOrders || null },
        180_000
      );
      return summary.value;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd, "aborted");
        return null;
      }
      if (requestId !== activeRequestRef.current) {
        console.log("[google/fbits-dashboard][ignored-stale]", requestId, requestStart, requestEnd, "error-after-stale");
        return null;
      }
      setFbitsError(friendlyError(error));
      return null;
    } finally {
      if (requestId === activeRequestRef.current) {
        setLoadingFbits(false);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [activeClientId, cachedInitial, isAuthenticated, rangeKey, safePeriod.end, safePeriod.start]);

  useEffect(() => {
    void reloadFbits();
    return () => {
      abortRef.current?.abort();
    };
  }, [reloadFbits]);

  return {
    fbitsData,
    fbitsOrders,
    fbitsError,
    loadingFbits,
    reloadFbits,
  };
}
