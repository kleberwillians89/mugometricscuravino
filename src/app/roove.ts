const envClientId = String(import.meta.env.VITE_DEFAULT_CLIENT_ID || "").trim();

// Sentinel fallback so the frontend never points to another tenant by accident.
const FALLBACK_CLIENT_ID = "__ROOVE_CLIENT_ID_NOT_CONFIGURED__";

let hasLoggedConfigWarning = false;

export const ROOVE_CLIENT_ID = envClientId || FALLBACK_CLIENT_ID;
export const ROOVE_CLIENT_NAME = "Roove";
export const ROOVE_APP_NAME = "Roove Metrics";
export const ROOVE_PANEL_NAME = "Painel Roove";
export const IS_ROOVE_CLIENT_ID_FALLBACK = !envClientId;

export function getRooveClientConfigurationWarning(): string | null {
  if (!IS_ROOVE_CLIENT_ID_FALLBACK) return null;
  return [
    "VITE_DEFAULT_CLIENT_ID nao foi definido.",
    "Configure o client_id real da Roove para liberar integracoes e dados em producao.",
  ].join(" ");
}

export function getRooveClientId(): string {
  const warning = getRooveClientConfigurationWarning();
  if (warning && !hasLoggedConfigWarning) {
    hasLoggedConfigWarning = true;
    console.warn(`[roove-config] ${warning}`);
  }
  return ROOVE_CLIENT_ID;
}
