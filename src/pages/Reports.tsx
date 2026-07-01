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
            Selecione o periodo e gere o resumo executivo com commerce, trafego, midia paga e Instagram.
          </div>
        ) : (
          <>
            <div className="staticReportMetrics">
              <MetricCard
                label="Receita commerce"
                value={brl(report.commerce.revenue)}
                hint={`${number(report.commerce.orders)} pedidos`}
              />
              <MetricCard
                label="Ticket medio"
                value={brl(report.commerce.average_ticket)}
                hint={`${brl(report.commerce.refunds)} em reembolsos`}
              />
              <MetricCard
                label="Sessoes"
                value={number(report.traffic.sessions)}
                hint={`${number(report.traffic.purchases)} compras GA4`}
              />
              <MetricCard
                label="Investimento"
                value={brl(report.paid_media.spend)}
                hint={`ROAS ${decimal(report.paid_media.roas)}`}
              />
              <MetricCard
                label="Alcance pago"
                value={number(report.paid_media.reach)}
                hint={`CTR ${decimal(report.paid_media.ctr)}%`}
              />
              <MetricCard
                label="Instagram"
                value={number(report.instagram.followers_growth)}
                hint={`${number(report.instagram.engagements)} engajamentos`}
              />
            </div>

            <div className="staticReportGrid">
              <article className="staticReportPanel">
                <header>
                  <h2>Top canais</h2>
                  <span>{number(report.traffic.sessions)} sessoes</span>
                </header>
                <div className="staticReportTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Sessoes</th>
                        <th>Compras</th>
                        <th>Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.traffic.channels.length ? (
                        report.traffic.channels.map((channel) => (
                          <tr key={channel.source_medium}>
                            <td>{channel.source_medium}</td>
                            <td>{number(channel.sessions)}</td>
                            <td>{number(channel.purchases)}</td>
                            <td>{brl(channel.revenue)}</td>
                          </tr>
                        ))
                      ) : (
                        <EmptyRow colSpan={4} label="Sem dados de canais no periodo." />
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="staticReportPanel">
                <header>
                  <h2>Top campanhas</h2>
                  <span>{brl(report.paid_media.spend)} investidos</span>
                </header>
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

              <article className="staticReportPanel">
                <header>
                  <h2>Top produtos</h2>
                  <span>{brl(report.commerce.revenue)} em vendas</span>
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

            <article className="staticReportInsights">
              <header>
                <h2>Insights</h2>
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
