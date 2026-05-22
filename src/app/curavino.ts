const CURAVINO_LOCAL_CLIENT_ID = "9cd90217-ccba-4467-a095-eedc21fe6e86";

const envCuravinoClientId = String(import.meta.env.VITE_CURAVINO_CLIENT_ID || "").trim();
const envActiveClientId = String(import.meta.env.VITE_ACTIVE_CLIENT_ID || "").trim();

let hasLoggedConfigWarning = false;

export const CURAVINO_CLIENT_ID = envCuravinoClientId || CURAVINO_LOCAL_CLIENT_ID;
export const CURAVINO_CLIENT_NAME = "Curavino";

// Legacy export names kept so existing imports continue to work in this Curavino-only copy.
export const ROOVE_CLIENT_ID = CURAVINO_CLIENT_ID;
export const ROOVE_CLIENT_NAME = CURAVINO_CLIENT_NAME;
export const ROOVE_APP_NAME = "Curavino Metrics";
export const ROOVE_PANEL_NAME = "Painel Curavino";
export const IS_ROOVE_CLIENT_ID_FALLBACK = false;
export const ACTIVE_CLIENT_ID = envActiveClientId || CURAVINO_CLIENT_ID;
export const ACTIVE_CLIENT_NAME = CURAVINO_CLIENT_NAME;

export const GA4_CLIENT_OPTIONS = [
  { id: CURAVINO_CLIENT_ID, name: CURAVINO_CLIENT_NAME },
];

export function getCuravinoClientConfigurationWarning(): string | null {
  return null;
}

export function getCuravinoClientId(): string {
  const warning = getCuravinoClientConfigurationWarning();
  if (warning && !hasLoggedConfigWarning) {
    hasLoggedConfigWarning = true;
    console.warn(`[curavino-config] ${warning}`);
  }
  return ACTIVE_CLIENT_ID;
}
