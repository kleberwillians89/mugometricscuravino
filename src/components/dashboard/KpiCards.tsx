import KpiCard from "../KpiCard";
import type { DashboardResponse, PaidDashboardResponse } from "../../app/types";
import type { KpiKey } from "../KpiGrid";

type Props = {
  kpis: Record<string, number>;
  kpisToday: Record<string, number>;
  dash: DashboardResponse | null;
  paidData?: PaidDashboardResponse | null;
  activeKpi: KpiKey;
  onSetActiveKpi: (k: KpiKey) => void;
};

type CardDef = {
  key: KpiKey;
  label: string;
};

const CARD_DEFS: CardDef[] = [
  { key: "followers", label: "Seguidores" },
  { key: "reach", label: "Alcance" },
  { key: "total_interactions", label: "Interações" },
  { key: "profile_views", label: "Visitas ao perfil" },
  { key: "website_clicks", label: "Cliques no link" },
  { key: "accounts_engaged", label: "Contas engajadas" },
];

function safe(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fmt(value: number): string {
  return value.toLocaleString("pt-BR");
}

function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function growthPct(current: number, previous: number): number | null {
  if (previous <= 5) return null;
  return ((current - previous) / previous) * 100;
}

export default function KpiCards({
  kpis,
  kpisToday,
  dash,
  paidData,
  activeKpi,
  onSetActiveKpi,
}: Props) {
  const previous = dash?.period_previous_totals;
  const daily = dash?.daily || [];
  const isPartial = Boolean(dash?.coverage?.is_partial);
  const paidDaily = Array.isArray(paidData?.daily) ? paidData!.daily : [];
  const paidTotals = paidData?.totals;
  const paidSpark = paidDaily.slice(Math.max(0, paidDaily.length - 14)).map((row) => safe(row?.spend));
  const paidToday = paidDaily.length ? safe(paidDaily[paidDaily.length - 1]?.spend) : 0;
  const paidHasData =
    safe(paidTotals?.spend) > 0 || safe(paidTotals?.impressions) > 0 || safe(paidTotals?.clicks) > 0;

  return (
    <div className="kpiGrid">
      <KpiCard
        label="Investimento Ads"
        value={fmtCurrency(safe(paidTotals?.spend))}
        todayValue={fmtCurrency(paidToday)}
        deltaLabel={paidHasData ? undefined : "Sem dados"}
        spark={paidSpark}
        tone="ads"
      />
      {CARD_DEFS.map((item) => {
        const value = safe(kpis[item.key]);
        const todayValue = safe(kpisToday[item.key]);

        const previousValue =
          item.key === "followers"
            ? safe(previous?.followers_growth)
            : safe(previous?.[item.key as keyof typeof previous]);

        const deltaPct = isPartial ? undefined : growthPct(value, previousValue);

        const spark =
          item.key === "followers"
            ? daily.map((row) => safe(row.followers))
            : daily.map((row) => safe(row[item.key as keyof typeof row]));

        return (
          <KpiCard
            key={item.key}
            label={item.label}
            value={fmt(value)}
            todayValue={fmt(todayValue)}
            deltaPct={deltaPct}
            deltaLabel={isPartial ? "Parcial" : undefined}
            spark={spark}
            tone="organic"
            active={activeKpi === item.key}
            onClick={() => onSetActiveKpi(item.key)}
          />
        );
      })}
    </div>
  );
}
