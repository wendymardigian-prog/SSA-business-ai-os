/**
 * Que dashboard se abre por defecto, en un solo lugar.
 *
 * Meta Ads si esta conectado (hay al menos una cuenta publicitaria sincronizando)
 * y la persona puede verlo; si no, Chat. Sin Chat, el primero que pueda abrir.
 * Sin ninguno, Mi cuenta: no pide permiso, asi que no hay vuelta en circulo con
 * `/dashboard`, que redirige aca.
 *
 * Puro y sin dependencias de servidor: lo prueba un test.
 */

import { availableDashboards } from "./available";

export const ADS_DASHBOARD_HREF = "/dashboard/dashboards/ads";
export const CHAT_DASHBOARD_HREF = "/dashboard/dashboards/chat";
/** Donde caer cuando la persona no puede ver ningun dashboard. */
export const NO_DASHBOARD_HREF = "/dashboard/cuenta";

export interface DefaultDashboardInput {
  can: (permission: string) => boolean;
  /** Hay una cuenta publicitaria de Meta sincronizando. */
  adsConnected: boolean;
}

export function defaultDashboard({ can, adsConnected }: DefaultDashboardInput): string {
  if (adsConnected && can("dashboards.ads.view")) return ADS_DASHBOARD_HREF;
  if (can("dashboards.chat.view")) return CHAT_DASHBOARD_HREF;
  return availableDashboards(can)[0]?.href ?? NO_DASHBOARD_HREF;
}
