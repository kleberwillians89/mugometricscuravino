/**
 * Relatório estático de Maio (Curavino)
 * 
 * Este arquivo contém os dados hardcoded do relatório executivo de maio.
 * Deve ser mantido intacto - não é dinâmico.
 * 
 * Para novos períodos, criar novo arquivo seguindo o padrão: `<mes>-static.ts`
 */

export const maioStaticReport = {
  month: "2026-05",
  title: "Curavino — Virada de Escala em Maio",
  isStatic: true,
  
  executive_summary: {
    mainInsight: "Maio foi o primeiro mês em que a Curavino mostrou um salto claro de escala.",
    description: "A operação praticamente dobrou em receita, pedidos e clientes, enquanto o volume de produtos vendidos mais que triplicou.",
  },

  kpis: {
    revenue_maio: 27957.67,
    revenue_abril: 14323.46,
    orders_maio: 67,
    orders_abril: 38,
    customers_maio: 58,
    customers_abril: 29,
    products_sold_maio: 203,
    products_sold_abril: 79,
    avg_ticket_maio: 417.28,
    avg_ticket_abril: 376.93,
  },

  investment: {
    amount: 1000,
    roas_gross: 27.9,
    revenue_incremental: 13527.0,
    baseline_avg_jan_april: 14434.67,
  },

  top_products: [
    { name: "Lazy Winemaker Laranja Sauvignon Blanc Natural", units: 27 },
    { name: "Manos Andinas Tinto Pinot Noir Trasiego", units: 23 },
    { name: "Huaso de Sauzal Tinto Pais", units: 12 },
    { name: "Lazy Winemaker Tinto Cabernet Franc Natural", units: 12 },
    { name: "Ajna Rebel Tinto Pinot Noir", units: 9 },
    { name: "Plano Mensal Explorador", units: 5 },
  ],

  insights: [
    "O crescimento não foi sustentado por um único fator.",
    "Houve expansão simultânea em pedidos, clientes e itens vendidos.",
    "A base de clientes dobrou, mostrando aquisição real.",
    "Tráfego começou a empurrar demanda para produtos com apelo.",
    "Com investimento mínimo, a operação praticamente dobrou.",
  ],

  conclusion: "Maio provou que a Curavino não precisa apenas vender mais. Ela precisa escalar com método.",
};

export type MaioReport = typeof maioStaticReport;
