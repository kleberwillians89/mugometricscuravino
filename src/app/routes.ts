export type AppRoute = "dashboard" | "google" | "reports";

export function getAppRouteFromPath(pathname: string): AppRoute {
  const normalized = String(pathname || "/").trim().toLowerCase();
  if (normalized.startsWith("/google") || normalized.startsWith("/analytics")) return "google";
  if (normalized.startsWith("/relatorios") || normalized.startsWith("/reports")) return "reports";
  return "dashboard";
}

export function getCurrentAppRoute(): AppRoute {
  return getAppRouteFromPath(window.location.pathname);
}

export function getPathForRoute(route: AppRoute): string {
  if (route === "google") return "/google";
  if (route === "reports") return "/relatorios";
  return "/";
}

export function navigateToAppRoute(route: AppRoute, options?: { replace?: boolean }) {
  const path = getPathForRoute(route);
  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({}, document.title, path);
}
