type Props = {
  clientName: string;
  connections: Array<{ id: string; label: string; status: string }>;
  activeConnectionId: string | null;
  onSelectConnection?: (connectionId: string) => void;
  periodPreset: "7d" | "30d" | "month" | "custom";
  onSelectPeriodPreset?: (preset: "7d" | "30d" | "month") => void;
  refreshing?: boolean;
  backgroundRefreshing?: boolean;
  oauthConnecting?: boolean;
  aiLoading?: boolean;
  organicLastUpdatedLabel?: string | null;
  paidLastUpdatedLabel?: string | null;
  onOpenGoogleAnalytics?: () => void;
  onOpenShopifyReport?: () => void;
  onConnectIntegration?: () => void | Promise<void>;
  onRefresh?: () => void;
  onAi?: () => void;
  onLogout: () => void | Promise<void>;
};

export default function DashboardHeader({
  clientName,
  connections,
  activeConnectionId,
  onSelectConnection,
  periodPreset,
  onSelectPeriodPreset,
  refreshing = false,
  backgroundRefreshing = false,
  oauthConnecting = false,
  aiLoading = false,
  organicLastUpdatedLabel = null,
  paidLastUpdatedLabel = null,
  onOpenGoogleAnalytics,
  onOpenShopifyReport,
  onConnectIntegration,
  onRefresh,
  onAi,
  onLogout,
}: Props) {
  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) || null;
  const currentClientName = String(clientName || "").trim() || "Roove";

  return (
    <div className="dashHeader">
      <div className="dashHeaderLeft">
        <div className="dashHeaderClientLabel">Marca</div>
        <div className="pill pillSoft">{currentClientName}</div>
        <div className="dashHeaderConnectionRow">
          <span className="dashHeaderConnectionLabel">Conexão ativa</span>
          <select
            className="select dashHeaderConnectionSelect"
            value={activeConnectionId || ""}
            onChange={(event) => onSelectConnection?.(event.target.value)}
            aria-label="Conexão ativa"
          >
            <option value="">
              {activeConnection ? activeConnection.label : "Sem conexão ativa"}
            </option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.label} ({connection.status})
              </option>
            ))}
          </select>
        </div>
        <div className="dashHeaderStatusRow">
          {organicLastUpdatedLabel ? (
            <span className="dashHeaderStatusChip">Orgânico: {organicLastUpdatedLabel}</span>
          ) : null}
          {paidLastUpdatedLabel ? (
            <span className="dashHeaderStatusChip">Ads: {paidLastUpdatedLabel}</span>
          ) : null}
          {backgroundRefreshing ? (
            <span className="dashHeaderStatusChip isRefreshing">Atualizando em background</span>
          ) : null}
        </div>
      </div>

      <div className="dashHeaderRight">
        <div className="dashHeaderPeriod">
          <span className="dashHeaderPeriodLabel">Período</span>
          <select
            className="select"
            value={periodPreset}
            onChange={(event) => {
              const next = event.target.value as "7d" | "30d" | "month" | "custom";
              if (next === "custom") return;
              onSelectPeriodPreset?.(next);
            }}
            aria-label="Período"
          >
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Mês atual</option>
            {periodPreset === "custom" ? <option value="custom">Personalizado</option> : null}
          </select>
        </div>
        {onConnectIntegration ? (
          <button
            className="btn btnGhost"
            onClick={onConnectIntegration}
            disabled={oauthConnecting}
            type="button"
          >
            {oauthConnecting ? "Conectando..." : "Conectar integração"}
          </button>
        ) : null}
        {onOpenGoogleAnalytics ? (
          <button className="btn btnGhost" onClick={onOpenGoogleAnalytics} type="button">
            Google / GA4
          </button>
        ) : null}
        {onOpenShopifyReport ? (
          <button className="btn btnGhost" onClick={onOpenShopifyReport} type="button">
            Dados Shopify
          </button>
        ) : null}
        {onRefresh ? (
          <button className="btn btnPrimary" onClick={onRefresh} disabled={refreshing} type="button">
            {refreshing ? "Atualizando..." : "Atualizar dados"}
          </button>
        ) : null}
        {onAi ? (
          <button className="btn btnGold" onClick={onAi} disabled={aiLoading} type="button">
            {aiLoading ? "Analisando..." : "Análise IA"}
          </button>
        ) : null}
        <button className="btnLogout" onClick={() => onLogout()} type="button">
          Sair
        </button>
      </div>
    </div>
  );
}
