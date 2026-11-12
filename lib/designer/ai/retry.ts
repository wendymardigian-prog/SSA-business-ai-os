/**
 * Qué hacer cuando falla el modelo en un job del Diseñador (mismo criterio que los jobs de IA del
 * resto del sistema: 1, 5 y 15 minutos). Puro.
 *
 * El job NO lanza por un fallo del proveedor: la cola reintentaría a los 10 y 20 segundos, que es poco
 * para un 429. Reagenda él mismo y, agotados los intentos (o ante un rechazo permanente, como una clave
 * inválida), deja el error en el hilo de la conversación.
 *
 * Vive acá y no se importa de Llamadas: el Diseñador viaja a plantillas que no tienen ese módulo.
 */

import { classifyPublishError } from "@/lib/jobs/errors";

export const AI_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export type AiFailureDecision = { action: "retry"; delayMs: number; nextRetry: number } | { action: "give_up"; message: string; permanent: boolean };

/** `retry` es cuántas veces ya se reintentó (0 la primera vez que falla). */
export function decideAiFailure(error: unknown, retry: number): AiFailureDecision {
  if (isTruncated(error)) return { action: "give_up", message: "respuesta cortada por largo", permanent: true };
  const classified = classifyPublishError(error);
  const message = classified.message.slice(0, 300) || "error desconocido";
  if (classified.kind === "permanent") return { action: "give_up", message, permanent: true };
  if (retry >= AI_RETRY_DELAYS_MS.length) return { action: "give_up", message, permanent: false };
  return { action: "retry", delayMs: AI_RETRY_DELAYS_MS[retry], nextRetry: retry + 1 };
}

/**
 * Si el rechazo es por la clave o la cuenta (401, 403 o un mensaje que lo dice). Solo en ese caso
 * tiene sentido mandar a la persona a revisar la conexión: un 400 por el pedido no se arregla ahí.
 */
export function isAuthFailure(error: unknown): boolean {
  const classified = classifyPublishError(error);
  if (classified.code === 401 || classified.code === 403) return true;
  const lower = classified.message.toLowerCase();
  return ["invalid x-api-key", "invalid api key", "invalid_api_key", "authentication", "unauthorized", "permission"].some((needle) => lower.includes(needle));
}

/** Un error con esta marca no se reintenta nunca (la respuesta del modelo se cortó por largo). */
export function isTruncated(error: unknown): boolean {
  return error instanceof Error && error.name === "TruncatedOutputError";
}
