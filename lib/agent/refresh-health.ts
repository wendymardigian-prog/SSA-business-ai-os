/**
 * Salud del refresco contra Zernio (F12). Sin refresco, la verificación queda
 * ciega, así que si falla mucho hay que avisar.
 */

export interface RefreshHealth {
  total: number;
  failed: number;
  /** Porcentaje de refrescos fallidos, 0–100, redondeado a un decimal. */
  failedPct: number;
}

const ALERT_THRESHOLD_PCT = 5;

/** Calcula la salud a partir de los routing de los runs de los últimos 7 días. */
export function refreshHealth(routings: Array<{ refresh?: string } | null | undefined>): RefreshHealth {
  let total = 0;
  let failed = 0;
  for (const r of routings) {
    const value = r?.refresh;
    if (value !== "ok" && value !== "failed") continue; // el run no hizo refresco
    total += 1;
    if (value === "failed") failed += 1;
  }
  const failedPct = total === 0 ? 0 : Math.round((failed / total) * 1000) / 10;
  return { total, failed, failedPct };
}

/** ¿Hay que avisar a Owner/Admin? Supera el umbral de 5% (con algo de volumen). */
export function shouldAlertRefreshHealth(health: RefreshHealth): boolean {
  return health.total >= 20 && health.failedPct > ALERT_THRESHOLD_PCT;
}

export { ALERT_THRESHOLD_PCT };
