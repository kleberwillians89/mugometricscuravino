import { useCallback, useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";

import Shell from "../components/Shell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import useDashboardGa4 from "../hooks/dashboard/useDashboardGa4";
import useDashboardFbits from "../hooks/dashboard/useDashboardFbits";
import FbitsSalesPanel from "../components/dashboard/FbitsSalesPanel";
import { backfillFbitsOrders, syncFbits, syncGa4 } from "../app/api";
import { usePeriod } from "../app/PeriodContext";
import { clearDashboardCache } from "../hooks/dashboard/cache";
import { buildMonthRange, formatSelectedPeriodLabel, getSelectedPeriodRange } from "../app/periodRange";
import type {
  Ga4CampaignRow,
  Ga4ChannelRow,
  Ga4DailyStatRow,
  Ga4EventGroup,
  Ga4EventRow,
  Ga4ReportResponse,
} from "../app/types";
import {
  GA4_CLIENT_OPTIONS,
  ACTIVE_CLIENT_ID,
  getCuravinoClientConfigurationWarning,
} from "../app/curavino";
import { CHART_COLORS, formatDatePtBr, formatFullNumber } from "../components/dashboard/chartTheme";

import "../styles/dashboard.css";
import "../styles/google-analytics.css";

type Props = {
  onLogout: () => void | Promise<void>;
  onOpenDashboard: () => void;
  onOpenReports?: () => void;
  isAuthenticated?: boolean;
};

type PeriodPreset = "7d" | "30d" | "month" | "specific";
type FbitsSyncPreset = "selected" | "current_month" | "previous_month" | "last_90_days";
const GA4_CLIENT_STORAGE_KEY = "mugo_metrics_ga4_client_id";
const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function todayDateInput() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
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

function monthFromPeriod(start: string | null | undefined) {
  const parts = calendarParts(start);
  if (!parts) return todayDateInput();
  return {
    month: parts.month,
    year: parts.year,
  };
}

function isShiftedMonthRange(start: string, end: string) {
  const startParts = calendarParts(start);
  const endParts = calendarParts(end);
  if (!startParts || !endParts) return false;
  if (startParts.day === 1 || endParts.day !== 1) return false;
  const expectedNextMonth = startParts.month === 12 ? 1 : startParts.month + 1;
  const expectedNextYear = startParts.month === 12 ? startParts.year + 1 : startParts.year;
  return endParts.month === expectedNextMonth && endParts.year === expectedNextYear;
}

function resolveInitialPreset(start: string, end: string, days: number): PeriodPreset {
  const now = new Date();
  const currentMonthStart = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const today = toDateInput(now);

  if (isShiftedMonthRange(start, end)) return "specific";
  if (days === 7) return "7d";
  if (days === 30) return "30d";
  if (start === currentMonthStart && end === today) return "month";
  return "specific";
}

function toErrorMessage(error: unknown) {
  console.warn("[google-ga4]", error);
  return "Não foi possível atualizar os dados agora. Tente novamente em instantes.";
}

function resolveFbitsSyncRange(
  preset: FbitsSyncPreset,
  selectedRange: { start: string; end: string }
) {
  const now = new Date();
  if (preset === "current_month") {
    return {
      start: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toDateInput(now),
    };
  }
  if (preset === "previous_month") {
    return {
      start: toDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: toDateInput(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (preset === "last_90_days") {
    return {
      start: toDateInput(addDays(now, -89)),
      end: toDateInput(now),
    };
  }
  return selectedRange;
}

function sameRange(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start === b.start && a.end === b.end;
}

function isFbitsIncomplete(data: unknown) {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const debug = record.debug && typeof record.debug === "object" ? (record.debug as Record<string, unknown>) : {};
  const source = String(record.source || debug.source_used || debug.source || "").trim();
  const message = String(record.message || "").toLowerCase();
  return source === "fbits_incomplete" || message.includes("incomplet");
}

function formatPct(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(value >= 10 ? 0 : 1) : "0.0"}%`;
}

function formatUpdatedAtLabel(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hasGa4Data(report: Ga4ReportResponse | null) {
  if (!report) return false;
  return (
    report.summary.sessions > 0 ||
    report.summary.event_count > 0
  );
}

function resolveInitialGa4ClientId() {
  const optionIds = new Set(GA4_CLIENT_OPTIONS.map((client) => client.id));
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = String(params.get("client_id") || "").trim();
    if (fromUrl && optionIds.has(fromUrl)) return fromUrl;

    const fromStorage = String(window.localStorage.getItem(GA4_CLIENT_STORAGE_KEY) || "").trim();
    if (fromStorage && optionIds.has(fromStorage)) return fromStorage;
  } catch {
    // Browser APIs may be unavailable during tests.
  }
  return ACTIVE_CLIENT_ID;
}

function uniqueGa4Options(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function persistGa4ClientId(clientId: string) {
  try {
    window.localStorage.setItem(GA4_CLIENT_STORAGE_KEY, clientId);
    const url = new URL(window.location.href);
    url.searchParams.set("client_id", clientId);
    window.history.replaceState({}, document.title, `${url.pathname}?${url.searchParams.toString()}`);
  } catch {
    // no-op
  }
}

function shortDateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}`;
}

function GoogleMetricCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <article className={`googleKpiCard ${accent ? "isAccent" : ""}`.trim()}>
      <div className="googleKpiLabel">{label}</div>
      <div className="googleKpiValue">{value}</div>
      <div className="googleKpiHint">{hint}</div>
    </article>
  );
}

function GoogleGroupTable({
  group,
  emptyMessage,
}: {
  group: Ga4EventGroup;
  emptyMessage: string;
}) {
  return (
    <article className="ga4GroupCard googleGroupCard cardWide">
      <div className="ga4GroupHead">
        <div>
          <div className="h1">{group.title}</div>
          <div className="p">{group.description}</div>
        </div>
        <div className="ga4GroupSummary">
          <span>{formatFullNumber(group.total_events)} ocorrências</span>
          <span>{formatFullNumber(group.total_users)} usuários</span>
        </div>
      </div>

      {group.items.length ? (
        <div className="tableWrap ga4TableWrap">
          <table className="table ga4GroupTable">
            <thead>
              <tr>
                <th>Evento</th>
                <th>Ocorrências</th>
                <th>Usuários</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.event_name}>
                  <td>
                    <div className="cellTitle">{item.label}</div>
                    {item.description ? <div className="cellMuted">{item.description}</div> : null}
                  </td>
                  <td>{formatFullNumber(item.event_count)}</td>
                  <td>{formatFullNumber(item.total_users)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="googleEmptyCard">{emptyMessage}</div>
      )}
    </article>
  );
}

function GoogleTopList({
  title,
  description,
  items,
  emptyMessage,
}: {
  title: string;
  description: string;
  items: Array<{
    id: string;
    label: string;
    meta: string;
    value: string;
    subvalue: string;
  }>;
  emptyMessage: string;
}) {
  return (
    <article className="googleListCard">
      <div className="googleListHead">
        <div>
          <div className="googleMiniLabel">{title}</div>
          <p className="googleChartDescription">{description}</p>
        </div>
      </div>

      {items.length ? (
        <div className="googleListRows">
          {items.map((item, index) => (
            <div key={item.id} className="googleListRow">
              <div className="googleListRank">{String(index + 1).padStart(2, "0")}</div>
              <div className="googleListBody">
                <div className="googleTableTitle">{item.label}</div>
                <div className="googleTableSubtle">{item.meta}</div>
              </div>
              <div className="googleListMetric">
                <strong>{item.value}</strong>
                <span>{item.subvalue}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="googleEmptyCard">{emptyMessage}</div>
      )}
    </article>
  );
}

function GoogleDailyTable({ rows }: { rows: Ga4DailyStatRow[] }) {
  if (!rows.length) {
    return <div className="googleEmptyCard">Sem dados no período.</div>;
  }
  return (
    <article className="googleListCard googleTableCard">
      <div className="tableWrap googleDataTableWrap">
        <table className="table googleDataTable">
          <thead>
            <tr>
              <th>Data</th>
              <th>Sessões</th>
              <th>Usuários ativos</th>
              <th>Usuários totais</th>
              <th>Eventos</th>
              <th>Evento purchase GA4</th>
              <th>View item</th>
              <th>Add cart</th>
              <th>Checkout</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <td>{formatDatePtBr(row.date)}</td>
                <td>{formatFullNumber(row.sessions)}</td>
                <td>{formatFullNumber(row.active_users)}</td>
                <td>{formatFullNumber(row.total_users)}</td>
                <td>{formatFullNumber(row.event_count)}</td>
                <td>{formatFullNumber(row.purchase_count || row.ecommerce_purchases)}</td>
                <td>{formatFullNumber(row.view_item_count)}</td>
                <td>{formatFullNumber(row.add_to_cart_count)}</td>
                <td>{formatFullNumber(row.begin_checkout_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function GoogleChannelsTable({ rows }: { rows: Ga4ChannelRow[] }) {
  if (!rows.length) {
    return <div className="googleEmptyCard">Sem dados no período.</div>;
  }
  return (
    <article className="googleListCard googleTableCard">
      <div className="tableWrap googleDataTableWrap">
        <table className="table googleDataTable">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Source</th>
              <th>Medium</th>
              <th>Sessões</th>
              <th>Usuários ativos</th>
              <th>Usuários totais</th>
              <th>Eventos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.source_medium}-${row.source}-${row.medium}`}>
                <td>
                  <div className="cellTitle">{row.source_medium || "Tráfego direto / indefinido"}</div>
                </td>
                <td>{row.source || "-"}</td>
                <td>{row.medium || "-"}</td>
                <td>{formatFullNumber(row.sessions)}</td>
                <td>{formatFullNumber(row.active_users)}</td>
                <td>{formatFullNumber(row.total_users)}</td>
                <td>{formatFullNumber(row.event_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function GoogleCampaignsTable({ rows }: { rows: Ga4CampaignRow[] }) {
  if (!rows.length) {
    return <div className="googleEmptyCard">Sem dados no período.</div>;
  }
  return (
    <article className="googleListCard googleTableCard">
      <div className="tableWrap googleDataTableWrap">
        <table className="table googleDataTable">
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Origem / mídia</th>
              <th>Sessões</th>
              <th>Usuários ativos</th>
              <th>Usuários totais</th>
              <th>Eventos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.campaign_name}-${row.source_medium}`}>
                <td>
                  <div className="cellTitle">{row.campaign_name || "Campanha sem nome"}</div>
                  <div className="cellMuted">{row.source || "-"} / {row.medium || "-"}</div>
                </td>
                <td>{row.source_medium || "-"}</td>
                <td>{formatFullNumber(row.sessions)}</td>
                <td>{formatFullNumber(row.active_users)}</td>
                <td>{formatFullNumber(row.total_users)}</td>
                <td>{formatFullNumber(row.event_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function GoogleEventsTable({ rows }: { rows: Ga4EventRow[] }) {
  if (!rows.length) {
    return <div className="googleEmptyCard">Sem dados no período.</div>;
  }
  return (
    <article className="googleListCard googleTableCard">
      <div className="tableWrap googleDataTableWrap">
        <table className="table googleDataTable">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Ocorrências</th>
              <th>Usuários</th>
              <th>Primeira leitura</th>
              <th>Última leitura</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event_name}>
                <td>
                  <div className="cellTitle">{row.label || row.event_name}</div>
                  {row.description ? <div className="cellMuted">{row.description}</div> : null}
                </td>
                <td>{formatFullNumber(row.event_count)}</td>
                <td>{formatFullNumber(row.total_users)}</td>
                <td>{row.first_seen_at ? formatDatePtBr(row.first_seen_at.slice(0, 10)) : "-"}</td>
                <td>{row.last_seen_at ? formatDatePtBr(row.last_seen_at.slice(0, 10)) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function GoogleAnalyticsSkeleton() {
  return (
    <div className="googleSkeletonLayout" aria-hidden="true">
      <div className="googleSkeletonHero skeleton" />
      <div className="googleSkeletonGrid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="googleSkeletonCard skeleton" />
        ))}
      </div>
      <div className="googleSkeletonCharts">
        <div className="googleSkeletonChart skeleton" />
        <div className="googleSkeletonChart skeleton" />
      </div>
      <div className="googleSkeletonTall skeleton" />
      <div className="googleSkeletonTall skeleton" />
      <div className="googleSkeletonTall skeleton" />
    </div>
  );
}

export default function GoogleAnalytics({
  onLogout,
  onOpenDashboard,
  onOpenReports,
  isAuthenticated = false,
}: Props) {
  const { period, periodDays, setCurrentMonthPeriod, setMonthPeriod, setPeriod, setPresetPeriod } = usePeriod();
  const [preset, setPreset] = useState<PeriodPreset>(() =>
    resolveInitialPreset(period.start, period.end, periodDays)
  );
  const initialDate = monthFromPeriod(period.start);
  const [selectedMonth, setSelectedMonth] = useState(initialDate.month);
  const [selectedYear, setSelectedYear] = useState(initialDate.year);
  const [selectedGa4ClientId, setSelectedGa4ClientId] = useState(resolveInitialGa4ClientId);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState("");
  const [sourceMediumFilter, setSourceMediumFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [fbitsSyncPreset, setFbitsSyncPreset] = useState<FbitsSyncPreset>("selected");
  const [syncingFbits, setSyncingFbits] = useState(false);
  const [fbitsSyncMessage, setFbitsSyncMessage] = useState<string | null>(null);
  const [fbitsSyncError, setFbitsSyncError] = useState<string | null>(null);
  const selectedGa4Client =
    GA4_CLIENT_OPTIONS.find((client) => client.id === selectedGa4ClientId) || GA4_CLIENT_OPTIONS[0];
  const activeGa4ClientId = selectedGa4Client?.id || ACTIVE_CLIENT_ID;
  const activeGa4ClientName = selectedGa4Client?.name || "cliente selecionado";
  const selectedRange = useMemo(() => {
    if (preset === "specific" || isShiftedMonthRange(period.start, period.end)) {
      const range = buildMonthRange(selectedYear, selectedMonth);
      return { start: range.start, end: range.end };
    }
    return getSelectedPeriodRange(period, selectedMonth, selectedYear);
  }, [period, preset, selectedMonth, selectedYear]);

  const {
    ga4Report,
    loadingGa4,
    refreshingGa4,
    ga4Error,
    ga4UpdatedAt,
    reloadGa4,
  } = useDashboardGa4({
    isAuthenticated,
    activeClientId: activeGa4ClientId,
    period: selectedRange,
  });
  const {
    fbitsData,
    fbitsOrders,
    fbitsError,
    loadingFbits,
    reloadFbits,
  } = useDashboardFbits({
    isAuthenticated,
    activeClientId: activeGa4ClientId,
    period: selectedRange,
  });

  useEffect(() => {
    if (selectedGa4ClientId === activeGa4ClientId) return;
    setSelectedGa4ClientId(activeGa4ClientId);
  }, [activeGa4ClientId, selectedGa4ClientId]);

  useEffect(() => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(period.start || "").trim());
    if (!match) return;
    setSelectedMonth(Number(match[2]));
    setSelectedYear(Number(match[1]));
    setPreset(resolveInitialPreset(period.start, period.end, periodDays));
  }, [period.end, period.start, periodDays]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }).map((_, index) => currentYear - index);
  }, []);

  const hasData = hasGa4Data(ga4Report);
  const combinedError = refreshError || ga4Error;
  const configWarning = activeGa4ClientId === ACTIVE_CLIENT_ID ? getCuravinoClientConfigurationWarning() : null;
  const lastSyncedLabel =
    formatUpdatedAtLabel(ga4Report?.meta.last_synced_at) || formatUpdatedAtLabel(ga4UpdatedAt);
  const pagePeriodLabel = `${formatDatePtBr(selectedRange.start)} - ${formatDatePtBr(selectedRange.end)}`;
  const fbitsIncomplete = isFbitsIncomplete(fbitsData);

  const dailyRows = ga4Report?.trends.daily || [];
  const trafficChartData = useMemo<ChartData<"line">>(
    () => ({
      labels: dailyRows.map((row) => shortDateLabel(row.date)),
      datasets: [
        {
          label: "Sessões",
          data: dailyRows.map((row) => row.sessions),
          borderColor: "#1a1718",
          backgroundColor: "rgba(26,23,24,.14)",
          borderWidth: 2.5,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
        },
        {
          label: "Usuários ativos",
          data: dailyRows.map((row) => row.active_users),
          borderColor: "#c79830",
          backgroundColor: "rgba(199,152,48,.12)",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
        },
      ],
    }),
    [dailyRows]
  );

  const lineOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: {
            boxWidth: 12,
            color: CHART_COLORS.axis,
            font: {
              weight: 700,
            },
          },
        },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          borderColor: CHART_COLORS.tooltipBorder,
          borderWidth: 1,
          titleColor: CHART_COLORS.tooltipText,
          bodyColor: CHART_COLORS.tooltipText,
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: CHART_COLORS.axis,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: CHART_COLORS.grid,
          },
          ticks: {
            color: CHART_COLORS.axis,
          },
        },
      },
    }),
    []
  );

  const filteredChannels = useMemo(() => {
    const channelNeedle = channelFilter.trim().toLowerCase();
    const sourceNeedle = sourceMediumFilter.trim().toLowerCase();
    const platformNeedle = platformFilter.trim().toLowerCase();
    const deviceNeedle = deviceFilter.trim().toLowerCase();
    return (ga4Report?.channels || []).filter((row) => {
      const dynamic = row as Ga4ChannelRow & { platform?: string; device?: string; device_category?: string };
      return (
        (!channelNeedle || String(row.source_medium || "").toLowerCase().includes(channelNeedle)) &&
        (!sourceNeedle || `${row.source || ""} ${row.medium || ""} ${row.source_medium || ""}`.toLowerCase().includes(sourceNeedle)) &&
        (!platformNeedle || String(dynamic.platform || "").toLowerCase().includes(platformNeedle)) &&
        (!deviceNeedle || `${dynamic.device || ""} ${dynamic.device_category || ""}`.toLowerCase().includes(deviceNeedle))
      );
    });
  }, [channelFilter, deviceFilter, ga4Report?.channels, platformFilter, sourceMediumFilter]);

  const filteredCampaigns = useMemo(() => {
    const campaignNeedle = campaignFilter.trim().toLowerCase();
    const sourceNeedle = sourceMediumFilter.trim().toLowerCase();
    const platformNeedle = platformFilter.trim().toLowerCase();
    const deviceNeedle = deviceFilter.trim().toLowerCase();
    return (ga4Report?.campaigns || []).filter((row) => {
      const dynamic = row as Ga4CampaignRow & { platform?: string; device?: string; device_category?: string };
      return (
        (!campaignNeedle || String(row.campaign_name || "").toLowerCase().includes(campaignNeedle)) &&
        (!sourceNeedle || `${row.source || ""} ${row.medium || ""} ${row.source_medium || ""}`.toLowerCase().includes(sourceNeedle)) &&
        (!platformNeedle || String(dynamic.platform || "").toLowerCase().includes(platformNeedle)) &&
        (!deviceNeedle || `${dynamic.device || ""} ${dynamic.device_category || ""}`.toLowerCase().includes(deviceNeedle))
      );
    });
  }, [campaignFilter, deviceFilter, ga4Report?.campaigns, platformFilter, sourceMediumFilter]);
  const channelOptions = useMemo(
    () => uniqueGa4Options((ga4Report?.channels || []).map((row) => row.source_medium)),
    [ga4Report?.channels]
  );
  const sourceMediumOptions = useMemo(
    () =>
      uniqueGa4Options([
        ...(ga4Report?.channels || []).map((row) => row.source_medium || `${row.source || ""} / ${row.medium || ""}`),
        ...(ga4Report?.campaigns || []).map((row) => row.source_medium || `${row.source || ""} / ${row.medium || ""}`),
      ]),
    [ga4Report?.campaigns, ga4Report?.channels]
  );
  const campaignOptions = useMemo(
    () => uniqueGa4Options((ga4Report?.campaigns || []).map((row) => row.campaign_name)),
    [ga4Report?.campaigns]
  );
  const platformOptions = useMemo(
    () =>
      uniqueGa4Options([
        ...(ga4Report?.channels || []).map((row) => (row as Ga4ChannelRow & { platform?: string }).platform),
        ...(ga4Report?.campaigns || []).map((row) => (row as Ga4CampaignRow & { platform?: string }).platform),
      ]),
    [ga4Report?.campaigns, ga4Report?.channels]
  );
  const deviceOptions = useMemo(
    () =>
      uniqueGa4Options([
        ...(ga4Report?.channels || []).flatMap((row) => {
          const dynamic = row as Ga4ChannelRow & { device?: string; device_category?: string };
          return [dynamic.device, dynamic.device_category];
        }),
        ...(ga4Report?.campaigns || []).flatMap((row) => {
          const dynamic = row as Ga4CampaignRow & { device?: string; device_category?: string };
          return [dynamic.device, dynamic.device_category];
        }),
      ]),
    [ga4Report?.campaigns, ga4Report?.channels]
  );

  const topChannels = useMemo(
    () =>
      [...filteredChannels]
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5)
        .map((row: Ga4ChannelRow) => ({
          id: row.source_medium || `${row.source || "source"}-${row.medium || "medium"}`,
          label: row.source_medium || "Tráfego direto / indefinido",
          meta: `${formatFullNumber(row.total_users)} usuários • ${formatFullNumber(row.event_count)} eventos`,
          value: `${formatFullNumber(row.sessions)} sessões`,
          subvalue: `${formatFullNumber(row.active_users)} usuários ativos`,
        })),
    [filteredChannels]
  );

  const topCampaigns = useMemo(
    () =>
      [...filteredCampaigns]
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5)
        .map((row: Ga4CampaignRow) => ({
          id: `${row.campaign_name}-${row.source_medium || "campaign"}`,
          label: row.campaign_name || "Campanha sem nome",
          meta: `${row.source_medium || "origem não identificada"} • ${formatFullNumber(row.event_count)} eventos`,
          value: `${formatFullNumber(row.sessions)} sessões`,
          subvalue: `${formatFullNumber(row.active_users)} usuários ativos`,
        })),
    [filteredCampaigns]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshError(null);
    setRefreshMessage(null);
    setSyncing(true);
    try {
      clearDashboardCache();
      const syncResults = await Promise.allSettled([
        syncGa4({
          start: selectedRange.start,
          end: selectedRange.end,
          days: periodDays,
        }, {
          clientId: activeGa4ClientId,
        }),
        syncFbits({
          start: selectedRange.start,
          end: selectedRange.end,
          days: periodDays,
        }, {
          clientId: activeGa4ClientId,
        }),
      ]);
      const rejectedSync = syncResults.find((result) => result.status === "rejected");
      if (rejectedSync?.status === "rejected") {
        console.warn("[google-refresh]", rejectedSync.reason);
        setRefreshError("Falha parcial ao atualizar. Mantendo a última leitura disponível.");
      }
      await Promise.allSettled([reloadGa4({ force: true }), reloadFbits({ force: true })]);
      setRefreshMessage("Dados atualizados com sucesso.");
    } catch (error: unknown) {
      setRefreshError(toErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }, [activeGa4ClientId, periodDays, reloadFbits, reloadGa4, selectedRange.end, selectedRange.start]);

  const handleOpenReport = useCallback(() => {
    setPeriod(selectedRange);
    onOpenReports?.();
  }, [onOpenReports, selectedRange, setPeriod]);

  const handleFbitsBackfill = useCallback(async () => {
    const syncRange = resolveFbitsSyncRange(fbitsSyncPreset, selectedRange);
    setFbitsSyncError(null);
    setFbitsSyncMessage(null);
    setSyncingFbits(true);
    try {
      const payload = await backfillFbitsOrders({
        start: syncRange.start,
        end: syncRange.end,
      }, {
        clientId: activeGa4ClientId,
      });
      const periodLabel = `${formatDatePtBr(syncRange.start)} - ${formatDatePtBr(syncRange.end)}`;
      const revenueLabel = brlFormatter.format(Number(payload.revenue_total || 0));
      setFbitsSyncMessage(
        `Sincronização concluída: ${payload.orders_saved} pedidos, ${payload.items_saved} itens e ${revenueLabel} em ${periodLabel}.`
      );
      if (sameRange(syncRange, selectedRange)) {
        await reloadFbits({ force: true });
      }
    } catch (error: unknown) {
      console.warn("[google/fbits-backfill]", error);
      setFbitsSyncError("Não foi possível sincronizar a FBits agora. Verifique a conexão e tente novamente.");
    } finally {
      setSyncingFbits(false);
    }
  }, [activeGa4ClientId, fbitsSyncPreset, reloadFbits, selectedRange]);

  function handleGa4ClientChange(nextClientId: string) {
    setSelectedGa4ClientId(nextClientId);
    persistGa4ClientId(nextClientId);
    setRefreshError(null);
  }

  function handlePresetChange(nextPreset: PeriodPreset) {
    setPreset(nextPreset);
    if (nextPreset === "7d") {
      setPresetPeriod(7);
      return;
    }
    if (nextPreset === "30d") {
      setPresetPeriod(30);
      return;
    }
    if (nextPreset === "month") {
      setCurrentMonthPeriod();
      return;
    }
    setMonthPeriod(selectedYear, selectedMonth);
  }

  function handleMonthChange(nextMonth: number) {
    setSelectedMonth(nextMonth);
    setPreset("specific");
    setMonthPeriod(selectedYear, nextMonth);
  }

  function handleYearChange(nextYear: number) {
    setSelectedYear(nextYear);
    setPreset("specific");
    setMonthPeriod(nextYear, selectedMonth);
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Shell
      themeClass="theme-curavino"
      title=""
      right={
        <DashboardHeader
          activeView="google"
          backgroundRefreshing={refreshingGa4}
          onLogout={onLogout}
          onOpenGoogleAnalytics={() => {}}
          onOpenMeta={onOpenDashboard}
          onOpenReports={onOpenReports}
          onRefresh={handleRefresh}
          onSelectPeriodPreset={(nextPreset) => handlePresetChange(nextPreset)}
          periodPreset={preset === "specific" ? "custom" : preset}
          refreshing={syncing}
          statusChips={[
            {
              connected: Boolean(ga4Report),
              label: `${ga4Report ? "GA4 com dados" : "GA4 aguardando dados"}${lastSyncedLabel ? ` • ${lastSyncedLabel}` : ""}`,
            },
            {
              connected: Boolean(fbitsData?.connected),
              label: `${fbitsData?.connected ? "FBits conectada" : "FBits aguardando dados"}`,
            },
          ]}
        />
      }
    >
      <div className="googleReportPage">
        {configWarning ? <div className="googleFeedbackCard isWarning">{configWarning}</div> : null}
        <section className="googleHero">
          <div className="googleHeroCopy">
            <div className="googlePageEyebrow">Google Analytics 4</div>
            <h1 className="googlePageTitle">Dados Google</h1>
            <p className="googlePageSubtitle">
              Visão clara do comportamento do site, da jornada comercial e dos sinais de merchandising da{" "}
              {activeGa4ClientName}. Dados provenientes do Google Analytics 4.
            </p>
            <div className="googleHeroMeta">
              <span className="pill">{pagePeriodLabel}</span>
              <span className="pill">Fonte: GA4 · {formatSelectedPeriodLabel(selectedRange)}</span>
              <span className="googleHeroTimestamp">
                Última leitura: {lastSyncedLabel || "aguardando sincronização"}
              </span>
            </div>
            <div className="googleHeroActions" aria-live="polite">
              <button
                className="googleHeroActionButton isPrimary"
                type="button"
                onClick={handleRefresh}
                disabled={syncing || loadingGa4 || loadingFbits}
              >
                {syncing ? "Atualizando..." : "Atualizar dados"}
              </button>
              <button
                className="googleHeroActionButton"
                type="button"
                onClick={handleOpenReport}
                disabled={!onOpenReports}
              >
                Gerar relatório
              </button>
              {refreshMessage ? <span className="googleHeroActionFeedback">{refreshMessage}</span> : null}
            </div>
            <div className="googleQuickNav">
              <a className="googleQuickNavLink" href="#google-sales">
                Comercial
              </a>
              <a className="googleQuickNavLink" href="#google-summary">
                Comportamento
              </a>
              <a className="googleQuickNavLink" href="#google-funnel">
                Funnel
              </a>
              <a className="googleQuickNavLink" href="#google-daily">
                Evolução
              </a>
              <a className="googleQuickNavLink" href="#google-channels">
                Canais
              </a>
              <a className="googleQuickNavLink" href="#google-campaigns">
                Campanhas
              </a>
              <a className="googleQuickNavLink" href="#google-events">
                Eventos
              </a>
              <a className="googleQuickNavLink" href="#google-behavior">
                Behavior
              </a>
              <a className="googleQuickNavLink" href="#google-engagement">
                Engagement
              </a>
              <a className="googleQuickNavLink" href="#google-merchandising">
                Merchandising
              </a>
            </div>
          </div>

          <div className="googleFilterCard">
            <label className="googleFilterField">
              <span>Período</span>
              <select
                className="select"
                value={preset}
                onChange={(event) => handlePresetChange(event.target.value as PeriodPreset)}
              >
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="month">Mês atual</option>
                <option value="specific">Mês específico</option>
              </select>
            </label>

            <label className="googleFilterField">
              <span>Mês</span>
              <select
                className="select"
                value={selectedMonth}
                onChange={(event) => handleMonthChange(Number(event.target.value))}
              >
                {Array.from({ length: 12 }).map((_, index) => {
                  const month = index + 1;
                  return (
                    <option key={month} value={month}>
                      {new Date(2026, index, 1).toLocaleDateString("pt-BR", { month: "long" })}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="googleFilterField">
              <span>Ano</span>
              <select
                className="select"
                value={selectedYear}
                onChange={(event) => handleYearChange(Number(event.target.value))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            {GA4_CLIENT_OPTIONS.length > 1 ? (
              <label className="googleFilterField">
                <span>Cliente</span>
                <select
                  className="select"
                  value={activeGa4ClientId}
                  onChange={(event) => handleGa4ClientChange(event.target.value)}
                >
                  {GA4_CLIENT_OPTIONS.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="googleStatusLine">
              {syncing || refreshingGa4
                ? "Sincronizando dados do GA4..."
                : hasData
                  ? "GA4 com dados carregados para o período."
                  : "GA4 carregado, mas sem dados relevantes neste período."}
            </div>

          </div>
        </section>

        <section className="googleSection googleCommercialSection" id="google-sales">
          <div className="sectionHeader">
            <div>
              <div className="h1">Comercial</div>
              <div className="p">Leitura oficial de vendas separada dos sinais de comportamento do GA4.</div>
            </div>
            <div className="googleFbitsSyncControls">
              <label className="googleFbitsSyncSelect">
                <span>Sincronizar</span>
                <select
                  className="select"
                  value={fbitsSyncPreset}
                  onChange={(event) => setFbitsSyncPreset(event.target.value as FbitsSyncPreset)}
                  disabled={syncingFbits}
                >
                  <option value="selected">Período selecionado</option>
                  <option value="current_month">Mês atual</option>
                  <option value="previous_month">Mês anterior</option>
                  <option value="last_90_days">Últimos 90 dias</option>
                </select>
              </label>
              <button
                className="googleFbitsSyncButton"
                type="button"
                onClick={handleFbitsBackfill}
                disabled={syncingFbits || loadingFbits}
              >
                {syncingFbits ? "Sincronizando..." : "Sincronizar FBits"}
              </button>
            </div>
          </div>
          {fbitsIncomplete ? (
            <div className="googleFeedbackCard isWarning">
              Dados FBits incompletos para este período. Clique em Sincronizar FBits.
            </div>
          ) : null}
          {fbitsSyncError ? <div className="googleFeedbackCard isError">{fbitsSyncError}</div> : null}
          {fbitsSyncMessage ? <div className="googleFeedbackCard isSuccess">{fbitsSyncMessage}</div> : null}
          <FbitsSalesPanel data={fbitsData} orders={fbitsOrders} loading={loadingFbits} error={fbitsError} />
        </section>

        {loadingGa4 && !ga4Report ? <GoogleAnalyticsSkeleton /> : null}

        {combinedError && !ga4Report ? (
          <div className="googleFeedbackCard isError">
            Não foi possível carregar os dados do Google Analytics agora. Tente atualizar em instantes.
          </div>
        ) : null}

        {ga4Report ? (
          <>
            {!hasData ? (
              <div className="googleFeedbackCard">
                Sem dados no período.
              </div>
            ) : null}

            {combinedError && hasData ? (
              <div className="googleFeedbackCard isWarning">
                Atualização parcial: a última base carregada continua visível.
              </div>
            ) : null}

            <section className="googleSection" id="google-summary">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Comportamento GA4</div>
                  <div className="p">Resumo executivo de tráfego, base de usuários e eventos observados no GA4.</div>
                </div>
                {lastSyncedLabel ? (
                  <div className="dashboardSectionMeta">
                    <span className="dashboardTimestamp">Atualizado em {lastSyncedLabel}</span>
                  </div>
                ) : null}
              </div>

              <div className="googleKpiGrid">
                <GoogleMetricCard
                  label="Sessões"
                  value={formatFullNumber(ga4Report.summary.sessions)}
                  hint={`${periodDays} dias analisados`}
                />
                <GoogleMetricCard
                  label="Usuários ativos"
                  value={formatFullNumber(ga4Report.summary.active_users)}
                  hint={`${formatFullNumber(ga4Report.summary.average_daily_active_users)} em média por dia`}
                />
                <GoogleMetricCard
                  label="Usuários totais"
                  value={formatFullNumber(ga4Report.summary.total_users)}
                  hint="Base total identificada no período"
                />
                <GoogleMetricCard
                  label="Eventos"
                  value={formatFullNumber(ga4Report.summary.event_count)}
                  hint={`${formatPct(
                    ga4Report.summary.sessions
                      ? (ga4Report.summary.event_count / ga4Report.summary.sessions) * 100
                      : 0
                  )} de eventos por 100 sessões`}
                />
              </div>

              <div className="googleChartGrid">
                <article className="googleChartCard">
                  <div className="googleChartCardHead">
                    <div>
                      <div className="googleMiniLabel">Tendência diária</div>
                      <p className="googleChartDescription">
                        Sessões e usuários ativos para entender o ritmo do site ao longo do período.
                      </p>
                    </div>
                    <div className="googleChartValue">{formatFullNumber(ga4Report.summary.sessions)}</div>
                  </div>
                  <div className="googleChartViewport">
                    {dailyRows.length ? (
                      <Line data={trafficChartData} options={lineOptions} />
                    ) : (
                      <div className="googleChartEmptyState">Sem série diária disponível para o período.</div>
                    )}
                  </div>
                </article>

              </div>

              <div className="googleSecondaryGrid">
                <GoogleTopList
                  title="Top canais"
                  description="As origens que mais trouxeram sessões e usuários no período."
                  items={topChannels}
                  emptyMessage="Ainda não há canais suficientes para ordenar neste período."
                />
                <GoogleTopList
                  title="Top campanhas"
                  description="Campanhas com maior contribuição de tráfego na leitura do GA4."
                  items={topCampaigns}
                  emptyMessage="Ainda não há campanhas com dados relevantes neste período."
                />
              </div>
            </section>

            <section className="googleSection" id="google-funnel">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Funnel</div>
                  <div className="p">
                    Jornada comercial principal do site com as taxas de avanço entre as etapas.
                  </div>
                </div>
              </div>

              <div className="ga4JourneyCard">
                <div className="ga4JourneyHead">
                  <div>
                    <div className="h1">Funil principal do site</div>
                    <div className="p">
                      Etapas mais importantes entre descoberta de produto, checkout e compra final.
                    </div>
                  </div>
                  <span className="pill">Tracking comportamental GA4</span>
                </div>

                <div className="ga4JourneyGrid">
                  <div className="ga4JourneyStep">
                    <span className="smallMuted">Visualizou produto</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.view_item)}</strong>
                    <span className="ga4JourneyHint">Base do funil</span>
                  </div>
                  <div className="ga4JourneyStep">
                    <span className="smallMuted">Adicionou ao carrinho</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.add_to_cart)}</strong>
                    <span className="ga4JourneyHint">Conversão a partir do produto</span>
                    <span className="ga4JourneyRate">
                      {formatPct(ga4Report.commerce_journey.summary.add_to_cart_rate)}
                    </span>
                  </div>
                  <div className="ga4JourneyStep">
                    <span className="smallMuted">Iniciou checkout</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.begin_checkout)}</strong>
                    <span className="ga4JourneyHint">Avanço do carrinho</span>
                    <span className="ga4JourneyRate">
                      {formatPct(ga4Report.commerce_journey.summary.checkout_rate)}
                    </span>
                  </div>
                  <div className="ga4JourneyStep">
                    <span className="smallMuted">Informou pagamento</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.add_payment_info)}</strong>
                    <span className="ga4JourneyHint">Checkout qualificado</span>
                    <span className="ga4JourneyRate">
                      {formatPct(ga4Report.commerce_journey.summary.payment_info_rate)}
                    </span>
                  </div>
                  <div className="ga4JourneyStep">
                    <span className="smallMuted">Evento purchase GA4</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.purchase)}</strong>
                    <span className="ga4JourneyHint">Conversão final</span>
                    <span className="ga4JourneyRate">
                      {formatPct(ga4Report.commerce_journey.summary.purchase_rate)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="googleSection" id="google-daily">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Evolução diária</div>
                  <div className="p">
                    Série de tráfego, usuários, eventos e passos do funil por dia.
                  </div>
                </div>
              </div>
              <GoogleDailyTable rows={dailyRows} />
            </section>

            <section className="googleSection" id="google-channels">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Canais</div>
                  <div className="p">
                    Origem e mídia com sessões, usuários e eventos no período.
                  </div>
                </div>
              </div>
              <div className="googleSourceFilters">
                <label>
                  <span>Canal</span>
                  <select className="select" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
                    <option value="">Todos os canais</option>
                    {channelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  <span>Source / medium</span>
                  <select className="select" value={sourceMediumFilter} onChange={(event) => setSourceMediumFilter(event.target.value)}>
                    <option value="">Todas as origens</option>
                    {sourceMediumOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  <span>Plataforma</span>
                  <select className="select" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
                    <option value="">Todas as plataformas</option>
                    {platformOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  <span>Dispositivo</span>
                  <select className="select" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
                    <option value="">Todos os dispositivos</option>
                    {deviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>
              <GoogleChannelsTable rows={filteredChannels} />
            </section>

            <section className="googleSection" id="google-campaigns">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Campanhas</div>
                  <div className="p">
                    Campanhas capturadas pelo GA4 com contribuição de tráfego e eventos.
                  </div>
                </div>
              </div>
              <div className="googleSourceFilters isCampaign">
                <label>
                  <span>Campanha GA4</span>
                  <select className="select" value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}>
                    <option value="">Todas as campanhas</option>
                    {campaignOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>
              <GoogleCampaignsTable rows={filteredCampaigns} />
            </section>

            <section className="googleSection" id="google-events">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Eventos</div>
                  <div className="p">
                    Eventos brutos do GA4 com contagem de ocorrências, usuários e janela de leitura.
                  </div>
                </div>
              </div>
              <GoogleEventsTable rows={ga4Report.events} />
            </section>

            <section className="googleSection" id="google-behavior">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Behavior</div>
                  <div className="p">
                    Eventos que mostram como as pessoas navegam, exploram páginas e avançam dentro do site.
                  </div>
                </div>
              </div>
              <GoogleGroupTable
                group={ga4Report.behavior}
                emptyMessage="Ainda não há eventos de comportamento para detalhar neste período."
              />
            </section>

            <section className="googleSection" id="google-engagement">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Engagement</div>
                  <div className="p">
                    Interações que ajudam a medir interesse, consumo de conteúdo e qualidade de navegação.
                  </div>
                </div>
              </div>
              <GoogleGroupTable
                group={ga4Report.engagement}
                emptyMessage="Ainda não há eventos de engajamento para detalhar neste período."
              />
            </section>

            <section className="googleSection" id="google-merchandising">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Merchandising</div>
                  <div className="p">
                    Sinais comerciais ligados a produto, vitrine, carrinho e intenção de compra.
                  </div>
                </div>
              </div>
              <GoogleGroupTable
                group={ga4Report.merchandising}
                emptyMessage="Ainda não há eventos de merchandising para detalhar neste período."
              />
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
