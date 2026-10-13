/** Aviso de errores de un endpoint (F8): 5 envios con error en 1 hora, un aviso por hora. */
export const ERROR_ALERT_THRESHOLD = 5;
const HOUR_MS = 60 * 60 * 1000;

export function shouldAlert(errorsLastHour: number, lastAlertAt: Date | string | null | undefined, now: Date): boolean {
  if (errorsLastHour < ERROR_ALERT_THRESHOLD) return false;
  if (!lastAlertAt) return true;
  const last = new Date(lastAlertAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= HOUR_MS;
}
