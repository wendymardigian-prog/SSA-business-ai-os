/**
 * Retencion de los envios (F7): el payload se vacia a los 90 dias y la fila se
 * conserva 12 meses (365 dias); despues se borra.
 */
export const CLEAR_PAYLOAD_AFTER_DAYS = 90;
export const DELETE_AFTER_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionAction = "keep" | "clear_payload" | "delete";

export function retentionAction(receivedAt: string | Date, now: Date): RetentionAction {
  const received = new Date(receivedAt).getTime();
  if (!Number.isFinite(received)) return "keep";
  const days = Math.floor((now.getTime() - received) / DAY_MS);
  if (days > DELETE_AFTER_DAYS) return "delete";
  if (days >= CLEAR_PAYLOAD_AFTER_DAYS) return "clear_payload";
  return "keep";
}

/** Las fechas de corte para las consultas del barrido. */
export function retentionCutoffs(now: Date): { clearBefore: string; deleteBefore: string } {
  return {
    clearBefore: new Date(now.getTime() - CLEAR_PAYLOAD_AFTER_DAYS * DAY_MS).toISOString(),
    deleteBefore: new Date(now.getTime() - (DELETE_AFTER_DAYS + 1) * DAY_MS).toISOString(),
  };
}
