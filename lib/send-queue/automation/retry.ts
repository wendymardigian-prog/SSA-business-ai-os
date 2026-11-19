/**
 * Reintentos de un envío de la cola. PURO.
 *
 * Un fallo de TRANSPORTE (Evolution no contestó, se cortó, 5xx, 429) se reintenta hasta tres veces con espera
 * creciente: a 1, 5 y 15 minutos (los mismos que los broadcasts). Si lo RECHAZA el destinatario (WhatsApp dijo que no:
 * cualquier otro 4xx, o el número no tiene WhatsApp), no se reintenta: reintentar no lo arregla.
 */

export type SendErrorKind = "transport" | "rejected";

export const QUEUE_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

/** El estado HTTP que devolvió Evolution (null o undefined = no respondió). */
export function classifyEvolutionStatus(status: number | null | undefined): SendErrorKind {
  if (status === null || status === undefined) return "transport";
  if (status >= 500 || status === 429 || status === 408) return "transport";
  if (status >= 400) return "rejected";
  return "transport";
}

export type RetryPlan = { retry: true; attempts: number; nextAttemptAt: Date } | { retry: false; attempts: number };

/**
 * Qué pasa después de un fallo. `attempts`: los fallos que llevaba ANTES de este. Con transporte y menos de tres
 * reintentos hechos, vuelve a la cola para `nextAttemptAt`; si no, queda fallido.
 */
export function retryPlan(kind: SendErrorKind, attempts: number, now: Date): RetryPlan {
  const next = attempts + 1;
  if (kind === "transport" && next <= QUEUE_RETRY_DELAYS_MS.length) {
    return { retry: true, attempts: next, nextAttemptAt: new Date(now.getTime() + QUEUE_RETRY_DELAYS_MS[next - 1]) };
  }
  return { retry: false, attempts: next };
}
