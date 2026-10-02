/**
 * Estado del sistema, la quinta tarjeta (A5). Tres señales, y nada mas:
 *
 *   - Errores en las corridas de las ultimas 24 h.
 *   - Integraciones que `integrationStatus()` (G3) ya marco en "Requiere
 *     atencion" o "Con error". Esto NO calcula vencimientos por su cuenta:
 *     consume el estado ya resuelto, con su unico umbral (EXPIRY_WARNING_DAYS).
 *   - Corridas sin precio cargado.
 *
 * No hay señal de "latido del worker": no existe esa fuente en el sistema, y
 * esta tarjeta no la inventa.
 */

export type SystemStatusLevel = "ok" | "warning" | "critical";

export interface SystemStatus {
  level: SystemStatusLevel;
  /** Sin ninguna corrida en 24 h, es verde con esta nota, nunca rojo. */
  noActivity: boolean;
  runsLast24h: number;
  errorsLast24h: number;
  /** null cuando no hubo corridas: no hay tasa que calcular. */
  errorRatePct: number | null;
  attentionIntegrations: number;
  errorIntegrations: number;
  missingPricing: number;
}

export function computeSystemStatus(input: {
  runsLast24h: number;
  errorsLast24h: number;
  /** El `status` ya resuelto de cada integracion por `integrationStatus()`. */
  integrationStatuses: string[];
  missingPricing: number;
}): SystemStatus {
  const { runsLast24h, errorsLast24h, integrationStatuses, missingPricing } = input;
  const attentionIntegrations = integrationStatuses.filter((s) => s === "attention").length;
  const errorIntegrations = integrationStatuses.filter((s) => s === "error").length;
  const errorRatePct = runsLast24h > 0 ? (errorsLast24h / runsLast24h) * 100 : null;

  const critical = (errorRatePct !== null && errorRatePct > 10) || errorIntegrations > 0;
  const warning = !critical && (errorsLast24h > 0 || attentionIntegrations > 0 || missingPricing > 0);

  return {
    level: critical ? "critical" : warning ? "warning" : "ok",
    noActivity: runsLast24h === 0,
    runsLast24h,
    errorsLast24h,
    errorRatePct,
    attentionIntegrations,
    errorIntegrations,
    missingPricing,
  };
}

export const SYSTEM_STATUS_LABELS: Record<SystemStatusLevel, string> = {
  ok: "Todo bien",
  warning: "Revisar",
  critical: "Con problemas",
};

/** El detalle del panel desplegable: una linea por señal, vacia si no aplica. */
export function systemStatusDetails(status: SystemStatus): string[] {
  const lines: string[] = [];
  if (status.noActivity) lines.push("Sin actividad en 24 h.");
  else if (status.errorsLast24h > 0) {
    const pct = status.errorRatePct !== null ? ` (${Math.round(status.errorRatePct)} % de las corridas)` : "";
    lines.push(`${status.errorsLast24h} corrida${status.errorsLast24h === 1 ? "" : "s"} con error en las últimas 24 h${pct}.`);
  } else {
    lines.push("Sin errores en las últimas 24 h.");
  }
  if (status.errorIntegrations > 0) {
    lines.push(`${status.errorIntegrations} integración${status.errorIntegrations === 1 ? "" : "es"} con error.`);
  }
  if (status.attentionIntegrations > 0) {
    lines.push(`${status.attentionIntegrations} integración${status.attentionIntegrations === 1 ? "" : "es"} que requiere${status.attentionIntegrations === 1 ? "" : "n"} atención.`);
  }
  if (status.errorIntegrations === 0 && status.attentionIntegrations === 0) lines.push("Las integraciones están bien.");
  if (status.missingPricing > 0) {
    lines.push(`${status.missingPricing} corrida${status.missingPricing === 1 ? "" : "s"} sin precio cargado.`);
  }
  lines.push("No hay una señal de latido del worker: esta tarjeta mira errores, integraciones y precios, nada más.");
  return lines;
}
