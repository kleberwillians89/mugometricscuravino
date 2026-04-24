import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";

import Shell from "../components/Shell";
import useDashboardGa4 from "../hooks/dashboard/useDashboardGa4";
import { syncGa4 } from "../app/api";
import { usePeriod } from "../app/PeriodContext";
import type { Ga4CampaignRow, Ga4ChannelRow, Ga4EventGroup, Ga4ReportResponse } from "../app/types";
import {
  getRooveClientConfigurationWarning,
  ROOVE_APP_NAME,
  ROOVE_CLIENT_ID,
  ROOVE_CLIENT_NAME,
} from "../app/roove";
import { CHART_COLORS, formatDatePtBr, formatFullNumber } from "../components/dashboard/chartTheme";

import "../styles/dashboard.css";
import "../styles/google-analytics.css";

type Props = {
  onLogout: () => void | Promise<void>;
  onOpenDashboard: () => void;
  onOpenShopifyReport?: () => void;
  isAuthenticated?: boolean;
};

type PeriodPreset = "7d" | "30d" | "month" | "specific";

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateInput() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

function resolveInitialPreset(start: string, end: string, days: number): PeriodPreset {
  const now = new Date();
  const currentMonthStart = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const today = toDateInput(now);

  if (days === 7) return "7d";
  if (days === 30) return "30d";
  if (start === currentMonthStart && end === today) return "month";
  return "specific";
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Não foi possível carregar os dados do Google Analytics.";
}

function formatCurrency(value: number) {
  try {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 2,
    });
  } catch {
    return String(value);
  }
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
    report.summary.event_count > 0 ||
    report.summary.purchase_revenue > 0
  );
}

function shortDateLabel(value: string) {
  const parsed = new Date(`${String(value || "").trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
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
  onOpenShopifyReport,
  isAuthenticated = false,
}: Props) {
  const { period, periodDays, setCurrentMonthPeriod, setMonthPeriod, setPresetPeriod } = usePeriod();
  const [preset, setPreset] = useState<PeriodPreset>(() =>
    resolveInitialPreset(period.start, period.end, periodDays)
  );
  const initialDate = todayDateInput();
  const [selectedMonth, setSelectedMonth] = useState(initialDate.month);
  const [selectedYear, setSelectedYear] = useState(initialDate.year);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const {
    ga4Report,
    loadingGa4,
    refreshingGa4,
    ga4Error,
    ga4UpdatedAt,
    reloadGa4,
  } = useDashboardGa4({
    isAuthenticated,
    activeClientId: ROOVE_CLIENT_ID,
    period,
  });

  useEffect(() => {
    const startDate = new Date(`${period.start}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return;
    setSelectedMonth(startDate.getMonth() + 1);
    setSelectedYear(startDate.getFullYear());
    setPreset(resolveInitialPreset(period.start, period.end, periodDays));
  }, [period.end, period.start, periodDays]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }).map((_, index) => currentYear - index);
  }, []);

  const hasData = hasGa4Data(ga4Report);
  const combinedError = refreshError || ga4Error;
  const configWarning = getRooveClientConfigurationWarning();
  const lastSyncedLabel =
    formatUpdatedAtLabel(ga4Report?.meta.last_synced_at) || formatUpdatedAtLabel(ga4UpdatedAt);
  const pagePeriodLabel = `${formatDatePtBr(period.start)} - ${formatDatePtBr(period.end)}`;

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

  const revenueChartData = useMemo<ChartData<"bar">>(
    () => ({
      labels: dailyRows.map((row) => shortDateLabel(row.date)),
      datasets: [
        {
          label: "Receita",
          data: dailyRows.map((row) => row.purchase_revenue),
          backgroundColor: "rgba(215,219,106,.78)",
          borderColor: "rgba(26,23,24,.18)",
          borderWidth: 1,
          borderRadius: 10,
          maxBarThickness: 24,
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

  const barOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          borderColor: CHART_COLORS.tooltipBorder,
          borderWidth: 1,
          titleColor: CHART_COLORS.tooltipText,
          bodyColor: CHART_COLORS.tooltipText,
          callbacks: {
            label: (context) => formatCurrency(Number(context.raw || 0)),
          },
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
            callback: (value) => formatCurrency(Number(value || 0)),
          },
        },
      },
    }),
    []
  );

  const topChannels = useMemo(
    () =>
      [...(ga4Report?.channels || [])]
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5)
        .map((row: Ga4ChannelRow) => ({
          id: row.source_medium || `${row.source || "source"}-${row.medium || "medium"}`,
          label: row.source_medium || "Tráfego direto / indefinido",
          meta: `${formatFullNumber(row.total_users)} usuários • ${formatFullNumber(row.event_count)} eventos`,
          value: `${formatFullNumber(row.sessions)} sessões`,
          subvalue: formatCurrency(row.purchase_revenue),
        })),
    [ga4Report?.channels]
  );

  const topCampaigns = useMemo(
    () =>
      [...(ga4Report?.campaigns || [])]
        .sort((a, b) => {
          const revenueDiff = b.purchase_revenue - a.purchase_revenue;
          if (revenueDiff !== 0) return revenueDiff;
          return b.sessions - a.sessions;
        })
        .slice(0, 5)
        .map((row: Ga4CampaignRow) => ({
          id: `${row.campaign_name}-${row.source_medium || "campaign"}`,
          label: row.campaign_name || "Campanha sem nome",
          meta: `${row.source_medium || "origem não identificada"} • ${formatFullNumber(row.ecommerce_purchases)} compras`,
          value: formatCurrency(row.purchase_revenue),
          subvalue: `${formatFullNumber(row.sessions)} sessões`,
        })),
    [ga4Report?.campaigns]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshError(null);
    setSyncing(true);
    try {
      await syncGa4({
        start: period.start,
        end: period.end,
        days: periodDays,
      });
      await reloadGa4({ force: true });
    } catch (error: unknown) {
      setRefreshError(toErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }, [period.end, period.start, periodDays, reloadGa4]);

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
      themeClass="theme-roove"
      title={ROOVE_APP_NAME}
      subtitle="Leitura dedicada de Google Analytics 4"
      right={
        <div className="googleShellActions">
          <button className="btn btnGhost" onClick={onOpenDashboard} type="button">
            Painel principal
          </button>
          {onOpenShopifyReport ? (
            <button className="btn btnGhost" onClick={onOpenShopifyReport} type="button">
              Dados Shopify
            </button>
          ) : null}
          <button className="btnLogout" onClick={() => onLogout()} type="button">
            Sair
          </button>
        </div>
      }
    >
      <div className="googleReportPage">
        {configWarning ? <div className="googleFeedbackCard isWarning">{configWarning}</div> : null}

        <section className="googleHero">
          <div className="googleHeroCopy">
            <div className="googlePageEyebrow">Google Analytics 4</div>
            <h1 className="googlePageTitle">Dados Google / GA4</h1>
            <p className="googlePageSubtitle">
              Visão clara do comportamento do site, da jornada comercial e dos sinais de merchandising da{" "}
              {ROOVE_CLIENT_NAME}.
            </p>
            <div className="googleHeroMeta">
              <span className="pill">{pagePeriodLabel}</span>
              {ga4Report?.property_id ? <span className="pill">Property {ga4Report.property_id}</span> : null}
              <span className="googleHeroTimestamp">
                Última leitura: {lastSyncedLabel || "aguardando sincronização"}
              </span>
            </div>
            <div className="googleQuickNav">
              <a className="googleQuickNavLink" href="#google-summary">
                Summary
              </a>
              <a className="googleQuickNavLink" href="#google-funnel">
                Funnel
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

            <div className="googleStatusLine">
              {syncing || refreshingGa4
                ? "Sincronizando dados do GA4..."
                : hasData
                  ? "GA4 com dados carregados para o período."
                  : "GA4 carregado, mas sem dados relevantes neste período."}
            </div>

            <button
              className="btn btnPrimary googleRefreshButton"
              disabled={syncing || refreshingGa4}
              onClick={() => void handleRefresh()}
              type="button"
            >
              {syncing || refreshingGa4 ? "Atualizando..." : "Atualizar dados"}
            </button>
          </div>
        </section>

        {loadingGa4 && !ga4Report ? <GoogleAnalyticsSkeleton /> : null}

        {combinedError && !ga4Report ? (
          <div className="googleFeedbackCard isError">
            Não foi possível carregar os dados do Google Analytics. {combinedError}
          </div>
        ) : null}

        {ga4Report ? (
          <>
            {!hasData ? (
              <div className="googleFeedbackCard">
                O acesso do Google ficou visível nesta rota mesmo quando o período ainda não tem eventos ou receita.
                Ajuste o intervalo ou rode uma sincronização para popular a leitura.
              </div>
            ) : null}

            {combinedError && hasData ? (
              <div className="googleFeedbackCard isWarning">
                Atualização parcial: a última base carregada continua visível. {combinedError}
              </div>
            ) : null}

            <section className="googleSection" id="google-summary">
              <div className="sectionHeader">
                <div>
                  <div className="h1">Summary</div>
                  <div className="p">
                    Resumo executivo de tráfego, base de usuários, eventos e receita observada no GA4.
                  </div>
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
                <GoogleMetricCard
                  label="Compras"
                  value={formatFullNumber(ga4Report.summary.purchases)}
                  hint={`${formatPct(ga4Report.commerce_journey.summary.purchase_rate_from_view_item)} de compra por view_item`}
                  accent
                />
                <GoogleMetricCard
                  label="Receita atribuída"
                  value={formatCurrency(ga4Report.summary.purchase_revenue)}
                  hint={`Receita total ${formatCurrency(ga4Report.summary.total_revenue)}`}
                  accent
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

                <article className="googleChartCard">
                  <div className="googleChartCardHead">
                    <div>
                      <div className="googleMiniLabel">Receita por dia</div>
                      <p className="googleChartDescription">
                        Leitura diária da receita de compra capturada pelo GA4.
                      </p>
                    </div>
                    <div className="googleChartValue">{formatCurrency(ga4Report.summary.purchase_revenue)}</div>
                  </div>
                  <div className="googleChartViewport">
                    {dailyRows.length ? (
                      <Bar data={revenueChartData} options={barOptions} />
                    ) : (
                      <div className="googleChartEmptyState">Sem receita diária disponível para o período.</div>
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
                  description="Campanhas com maior contribuição de receita ou tráfego na leitura do GA4."
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
                  <span className="pill">{formatCurrency(ga4Report.summary.purchase_revenue)} em receita</span>
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
                    <span className="smallMuted">Comprou</span>
                    <strong>{formatFullNumber(ga4Report.commerce_journey.summary.purchase)}</strong>
                    <span className="ga4JourneyHint">Conversão final</span>
                    <span className="ga4JourneyRate">
                      {formatPct(ga4Report.commerce_journey.summary.purchase_rate)}
                    </span>
                  </div>
                </div>
              </div>
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
