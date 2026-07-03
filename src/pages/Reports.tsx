import { useMemo, useState } from "react";
import Shell from "../components/Shell";
import { getStaticReport, getStaticReportPdf } from "../app/api";
import { ROOVE_APP_NAME } from "../app/curavino";
import { usePeriod } from "../app/PeriodContext";
import type { StaticReportResponse } from "../app/types";
import "../styles/reports.css";

type Props = {
  onLogout: () => void | Promise<void>;
  onOpenDashboard: () => void;
  onOpenGoogleAnalytics: () => void;
  isAuthenticated?: boolean;
};

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function number(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function decimal(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function pct(value: number) {
  return `${decimal(value, 1)}%`;
}

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOrNull(value: unknown) {
  const parsed = safeNumber(value, 0);
  return parsed > 0 ? parsed : null;
}

function variationPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function variationLabel(value: number | null) {
  if (value == null) return "Sem base comparativa suficiente";
  const sign = value > 0 ? "+" : "";
  return `${sign}${decimal(value, 1)}%`;
}

function variationReading(label: string, value: number | null) {
  if (value == null) return "Sem base comparativa suficiente.";
  if (Math.abs(value) < 0.1) return `${label} ficou estavel em relacao ao mes anterior.`;
  if (value > 0) return `${label} cresceu em relacao ao mes anterior.`;
  return `${label} reduziu em relacao ao mes anterior, dentro da leitura do periodo.`;
}

function dateLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function EmptyRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td className="staticReportEmptyCell" colSpan={colSpan}>
        {label}
      </td>
    </tr>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="staticReportMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

const COMMERCIAL_OPPORTUNITIES = [
  { name: "PIX com desconto", status: "Pendente" },
  { name: "Parcelamento em ate 10x", status: "Pendente" },
  { name: "Recuperacao de Carrinho", status: "Em desenvolvimento" },
  { name: "Remarketing", status: "Ativo" },
  { name: "Google Merchant", status: "Ativo" },
  { name: "Meta Catalogo", status: "Ativo" },
];

const PROJECT_IMPLEMENTED = [
  "Dashboard",
  "Merchant Center",
  "Meta Catalogo",
  "Relatorio Executivo",
  "Conversoes",
];

const PROJECT_NEXT_STEPS = [
  "PIX com desconto",
  "Parcelamento em 10x",
  "Automacoes",
  "Remarketing",
  "Novas campanhas",
];

function channelGroup(label: string) {
  const text = label.toLowerCase();
  if (text.includes("google") || text.includes("cpc") || text.includes("paid search")) return "Google";
  if (text.includes("facebook") || text.includes("instagram") || text.includes("meta")) {
    return text.includes("instagram") ? "Instagram" : "Meta";
  }
  if (text.includes("organic") || text.includes("organico") || text.includes("search")) return "Organico";
  if (text.includes("direct") || text.includes("direto") || text.includes("(none)")) return "Direto";
  return "Outros";
}

function buildChannelRows(report: StaticReportResponse) {
  const totalAttributed = safeNumber(report.traffic.revenue);
  const rows = new Map<string, { channel: string; revenue: number; orders: number }>();
  for (const item of report.traffic.channels || []) {
    const channel = channelGroup(`${item.source_medium || ""} ${item.source || ""} ${item.medium || ""}`);
    const current = rows.get(channel) || { channel, revenue: 0, orders: 0 };
    current.revenue += safeNumber(item.revenue);
    current.orders += safeNumber(item.purchases);
    rows.set(channel, current);
  }

  return ["Google", "Meta", "Organico", "Direto", "Instagram", "Outros"].map((channel) => {
    const row = rows.get(channel) || { channel, revenue: 0, orders: 0 };
    return {
      ...row,
      share: totalAttributed > 0 ? (row.revenue / totalAttributed) * 100 : 0,
    };
  });
}

function plannedInvestment(report: StaticReportResponse) {
  const paid = report.paid_media as typeof report.paid_media & Record<string, unknown>;
  return positiveOrNull(paid.planned_spend ?? paid.planned_investment ?? paid.budget ?? paid.budget_total);
}

function buildMonthlyComparisons(report: StaticReportResponse) {
  const previous = report.previous_commerce;
  const currentOrdersOrLeads = safeNumber(report.commerce.orders) || safeNumber(report.paid_media.conversions);
  const previousOrdersOrLeads = previous ? safeNumber(previous.orders) : 0;
  const currentTicket = safeNumber(report.commerce.average_ticket);
  const previousTicket = previous ? safeNumber(previous.average_ticket) : 0;
  const currentAttributedRevenue = safeNumber(report.traffic.revenue);
  const currentInvestment = safeNumber(report.paid_media.spend);
  const currentRoas = currentInvestment > 0 && currentAttributedRevenue > 0 ? currentAttributedRevenue / currentInvestment : null;
  const currentCost = currentInvestment > 0 && currentOrdersOrLeads > 0 ? currentInvestment / currentOrdersOrLeads : null;

  return [
    {
      label: "Receita Total",
      current: brl(report.commerce.revenue),
      previous: previous ? brl(previous.revenue) : null,
      variation: variationPercent(safeNumber(report.commerce.revenue), previous ? safeNumber(previous.revenue) : 0),
      readingLabel: "A receita",
    },
    {
      label: "Pedidos/leads",
      current: number(currentOrdersOrLeads),
      previous: previous ? number(previousOrdersOrLeads) : null,
      variation: variationPercent(currentOrdersOrLeads, previousOrdersOrLeads),
      readingLabel: "O volume de pedidos/leads",
    },
    {
      label: "Ticket medio",
      current: brl(currentTicket),
      previous: previous ? brl(previousTicket) : null,
      variation: variationPercent(currentTicket, previousTicket),
      readingLabel: "O ticket medio",
    },
    {
      label: "Investimento em midia",
      current: brl(currentInvestment),
      previous: null,
      variation: null,
      readingLabel: "O investimento em midia",
    },
    {
      label: "Receita atribuida ao marketing",
      current: brl(currentAttributedRevenue),
      previous: null,
      variation: null,
      readingLabel: "A receita atribuida ao marketing",
    },
    {
      label: "ROAS",
      current: currentRoas == null ? "Nao calculado" : decimal(currentRoas),
      previous: null,
      variation: null,
      readingLabel: "O ROAS",
    },
    {
      label: "Custo por lead/aquisicao",
      current: currentCost == null ? "Nao calculado" : brl(currentCost),
      previous: null,
      variation: null,
      readingLabel: "O custo por lead/aquisicao",
    },
  ];
}

export default function Reports({
  onLogout,
  onOpenDashboard,
  onOpenGoogleAnalytics,
  isAuthenticated,
}: Props) {
  const { period, setPeriod } = usePeriod();
  const [draftStart, setDraftStart] = useState(period.start);
  const [draftEnd, setDraftEnd] = useState(period.end);
  const [report, setReport] = useState<StaticReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatedLabel = useMemo(() => {
    if (!report) return "Nenhum relatorio gerado nesta sessao.";
    return `${dateLabel(report.period.start)} a ${dateLabel(report.period.end)}`;
  }, [report]);
  const channelRows = useMemo(() => (report ? buildChannelRows(report) : []), [report]);
  const plannedMedia = report ? plannedInvestment(report) : null;
  const consumedMedia = report ? safeNumber(report.paid_media.spend) : 0;
  const mediaBalance = plannedMedia == null ? null : Math.max(0, plannedMedia - consumedMedia);
  const attributedRevenue = report ? safeNumber(report.traffic.revenue) : 0;
  const paidAttributedRevenue = report ? safeNumber(report.paid_media.revenue) : 0;
  const marketingRoas = consumedMedia > 0 && attributedRevenue > 0 ? attributedRevenue / consumedMedia : null;
  const paidRoas = consumedMedia > 0 && paidAttributedRevenue > 0 ? paidAttributedRevenue / consumedMedia : null;
  const monthlyComparisons = useMemo(() => (report ? buildMonthlyComparisons(report) : []), [report]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    const nextPeriod = { start: draftStart, end: draftEnd };
    setPeriod(nextPeriod);
    try {
      const next = await getStaticReport(nextPeriod);
      console.log("[reports/static]", next.debug_version, next.commerce?.debug, next.commerce);
      setReport(next);
    } catch (requestError: unknown) {
      console.warn("[static-report]", requestError);
      setError("Nao foi possivel gerar o relatorio agora.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExportPdf() {
    setPdfLoading(true);
    setError(null);
    const nextPeriod = { start: draftStart, end: draftEnd };
    setPeriod(nextPeriod);
    try {
      const { blob, filename } = await getStaticReportPdf(nextPeriod);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError: unknown) {
      console.warn("[static-report-pdf]", requestError);
      setError("Nao foi possivel exportar o PDF agora.");
    } finally {
      setPdfLoading(false);
    }
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Shell
      themeClass="theme-curavino"
      title={ROOVE_APP_NAME}
      subtitle="Relatorios executivos mensais"
      right={
        <div className="staticReportActions">
          <button className="btn btnGhost" onClick={onOpenDashboard} type="button">
            Dados Meta
          </button>
          <button className="btn btnGhost" onClick={onOpenGoogleAnalytics} type="button">
            Dados Google
          </button>
          <button className="btnLogout" onClick={() => onLogout()} type="button">
            Sair
          </button>
        </div>
      }
    >
      <section className="staticReportPage">
        <div className="staticReportToolbar">
          <div>
            <div className="staticReportEyebrow">Relatorios</div>
            <h1>Gerar Relatorio</h1>
            <p>{generatedLabel}</p>
          </div>

          <div className="staticReportControls">
            <label>
              Inicio
              <input
                type="date"
                value={draftStart}
                onChange={(event) => setDraftStart(event.target.value)}
              />
            </label>
            <label>
              Fim
              <input
                type="date"
                value={draftEnd}
                onChange={(event) => setDraftEnd(event.target.value)}
              />
            </label>
            <button className="btn btnPrimary" disabled={loading} onClick={handleGenerate} type="button">
              {loading ? "Gerando..." : "Gerar relatorio"}
            </button>
            <button
              className="btn btnGhost"
              disabled={pdfLoading}
              onClick={handleExportPdf}
              type="button"
            >
              {pdfLoading ? "Exportando..." : "Exportar PDF"}
            </button>
          </div>
        </div>

        {error ? <div className="staticReportFeedback">{error}</div> : null}

        {!report ? (
          <div className="staticReportInitial">
            Selecione o periodo e gere uma leitura executiva com vendas, investimento, receita atribuida e proximas acoes.
          </div>
        ) : (
          <>
            <div className="staticReportNarrative">
              <div>
                <div className="staticReportEyebrow">Resumo para decisao</div>
                <h2>O que aconteceu no periodo</h2>
              </div>
              <p>
                A leitura separa o faturamento total da loja da receita atribuida aos canais de marketing.
                Assim fica claro o que a empresa vendeu, quanto foi investido e qual parte do resultado pode
                ser relacionada as iniciativas digitais.
              </p>
            </div>

            <div className="staticReportMetrics staticReportMetricsFeatured">
              <MetricCard
                label="Receita Total do E-commerce"
                value={brl(report.commerce.revenue)}
                hint="Valor total faturado pela loja durante o periodo, considerando todos os canais."
              />
              <MetricCard
                label="Receita Atribuida ao Marketing"
                value={brl(attributedRevenue)}
                hint="Estimativa da receita relacionada aos canais de marketing digital."
              />
              <MetricCard
                label="Pedidos"
                value={number(report.commerce.orders)}
                hint="Quantidade de pedidos registrados pela fonte comercial do periodo."
              />
            </div>

            <div className="staticReportExplainer">
              Caso algum canal nao tenha atribuicao confiavel, ele aparece sem valor estimado. Receita total e receita atribuida nao sao somadas nem misturadas.
            </div>

            <div className="staticReportMetrics">
              <MetricCard
                label="Investimento Planejado"
                value={plannedMedia == null ? "Nao informado" : brl(plannedMedia)}
                hint="Valor previsto para campanhas no periodo, quando informado."
              />
              <MetricCard label="Investimento Consumido" value={brl(consumedMedia)} hint="Valor efetivamente consumido pelas campanhas." />
              <MetricCard label="Saldo nao utilizado" value={mediaBalance == null ? "Nao informado" : brl(mediaBalance)} hint="Diferenca entre o planejado e o valor consumido." />
              <MetricCard label="ROAS Marketing Total" value={marketingRoas == null ? "Nao calculado" : decimal(marketingRoas)} hint="Receita atribuida dividida pelo investimento realizado." />
              <MetricCard label="Sessoes" value={number(report.traffic.sessions)} hint="Volume de visitas registrado no periodo." />
              <MetricCard label="Instagram" value={number(report.instagram.followers_growth)} hint={`${number(report.instagram.engagements)} engajamentos organicos.`} />
            </div>

            <article className="staticReportPanel staticReportPanelWide">
              <header>
                <h2>Comparativo Mensal</h2>
                <span>Mes atual x mes anterior</span>
              </header>
              <p className="staticReportPanelDescription">
                Evolucao simples dos principais indicadores. Quando o mes anterior nao esta disponivel no relatorio, a comparacao fica sinalizada sem estimativa.
              </p>
              <div className="staticReportComparisonGrid">
                {monthlyComparisons.map((item) => (
                  <div className="staticReportComparisonCard" key={item.label}>
                    <div className="staticReportComparisonTop">
                      <strong>{item.label}</strong>
                      <span className={item.variation == null ? "" : item.variation >= 0 ? "isPositive" : "isNegative"}>
                        {variationLabel(item.variation)}
                      </span>
                    </div>
                    <div className="staticReportComparisonValues">
                      <div>
                        <span>Mes atual</span>
                        <strong>{item.current}</strong>
                      </div>
                      <div>
                        <span>Mes anterior</span>
                        <strong>{item.previous || "Sem base comparativa suficiente"}</strong>
                      </div>
                    </div>
                    <p>{variationReading(item.readingLabel, item.variation)}</p>
                  </div>
                ))}
              </div>
            </article>

            <div className="staticReportGrid">
              <article className="staticReportPanel staticReportPanelWide">
                <header>
                  <h2>Receita por Canal</h2>
                  <span>Receita atribuida: {brl(attributedRevenue)}</span>
                </header>
                <p className="staticReportPanelDescription">
                  Esta tabela mostra apenas a receita atribuida aos canais de marketing e navegacao digital. Quando nao houver dados confiaveis, o canal fica zerado.
                </p>
                <div className="staticReportTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Receita</th>
                        <th>Participacao</th>
                        <th>Pedidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelRows.map((row) => (
                        <tr key={row.channel}>
                          <td>{row.channel}</td>
                          <td>{brl(row.revenue)}</td>
                          <td>{pct(row.share)}</td>
                          <td>{row.orders ? number(row.orders) : "Nao disponivel"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="staticReportPanel">
                <header>
                  <h2>ROAS</h2>
                  <span>Com receita atribuida</span>
                </header>
                <div className="staticReportRoasList">
                  <div>
                    <strong>Meta</strong>
                    <span>{paidRoas == null ? "Nao foi possivel calcular este indicador com seguranca utilizando os dados disponiveis." : decimal(paidRoas)}</span>
                  </div>
                  <div>
                    <strong>Marketing Total</strong>
                    <span>{marketingRoas == null ? "Nao foi possivel calcular este indicador com seguranca utilizando os dados disponiveis." : decimal(marketingRoas)}</span>
                  </div>
                </div>
              </article>

              <article className="staticReportPanel">
                <header>
                  <h2>Produtos vendidos</h2>
                  <span>{brl(report.commerce.revenue)} em vendas totais</span>
                </header>
                <div className="staticReportTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Qtd.</th>
                        <th>Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.commerce.top_products.length ? (
                        report.commerce.top_products.map((product) => (
                          <tr key={product.product_id || product.variant_id || product.title}>
                            <td>{product.title}</td>
                            <td>{number(product.quantity)}</td>
                            <td>{brl(product.revenue)}</td>
                          </tr>
                        ))
                      ) : (
                        <EmptyRow colSpan={3} label="Sem produtos vendidos no periodo." />
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="staticReportPanel">
                <header>
                  <h2>Top campanhas</h2>
                  <span>{brl(consumedMedia)} consumidos</span>
                </header>
                <p className="staticReportPanelDescription">
                  A receita aqui e atribuida as campanhas. Ela nao representa a receita total da loja.
                </p>
                <div className="staticReportTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Campanha</th>
                        <th>Invest.</th>
                        <th>Cliques</th>
                        <th>ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.paid_media.campaigns.length ? (
                        report.paid_media.campaigns.map((campaign) => (
                          <tr key={campaign.campaign_id || campaign.campaign_name}>
                            <td>{campaign.campaign_name}</td>
                            <td>{brl(campaign.spend)}</td>
                            <td>{number(campaign.clicks)}</td>
                            <td>{decimal(campaign.roas)}</td>
                          </tr>
                        ))
                      ) : (
                        <EmptyRow colSpan={4} label="Sem dados de campanhas no periodo." />
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="staticReportPanel staticReportPanelWide">
                <header>
                  <h2>Oportunidades Comerciais</h2>
                  <span>Acoes combinadas</span>
                </header>
                <div className="staticReportStatusGrid">
                  {COMMERCIAL_OPPORTUNITIES.map((item) => (
                    <div key={item.name} className="staticReportStatusItem">
                      <strong>{item.name}</strong>
                      <span>{item.status}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="staticReportPanel">
                <header>
                  <h2>Top posts</h2>
                  <span>{number(report.instagram.reach)} alcance organico</span>
                </header>
                <div className="staticReportTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Publicacao</th>
                        <th>Alcance</th>
                        <th>Engaj.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.instagram.top_posts.length ? (
                        report.instagram.top_posts.map((post) => (
                          <tr key={post.media_id}>
                            <td>
                              {post.permalink ? (
                                <a href={post.permalink} rel="noreferrer" target="_blank">
                                  {post.caption || post.media_id}
                                </a>
                              ) : (
                                post.caption || post.media_id
                              )}
                            </td>
                            <td>{number(post.reach)}</td>
                            <td>{number(post.engagements)}</td>
                          </tr>
                        ))
                      ) : (
                        <EmptyRow colSpan={3} label="Sem posts no periodo." />
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>

            <article className="staticReportPanel staticReportPanelWide">
              <header>
                <h2>Evolucao do Projeto</h2>
                <span>Entregas e proximas acoes</span>
              </header>
              <div className="staticReportProjectGrid">
                <div>
                  <h3>Implementado neste periodo</h3>
                  <ul>
                    {PROJECT_IMPLEMENTED.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3>Proximas entregas</h3>
                  <ul>
                    {PROJECT_NEXT_STEPS.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            </article>

            <article className="staticReportInsights">
              <header>
                <h2>Leitura Consultiva</h2>
                <span>Resumo executivo</span>
              </header>
              <ul>
                {report.insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ul>
            </article>
          </>
        )}
      </section>
    </Shell>
  );
}
