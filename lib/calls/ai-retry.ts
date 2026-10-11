/**
 * Que hacer cuando falla el modelo en un job de Llamadas. Puro.
 *
 * Los handlers NO lanzan por un fallo del proveedor: la cola reintentaria a los
 * 10 y 20 segundos, que es poco para un 429. Reagendan ellos mismos (1, 5 y 15
 * minutos, como el resto del sistema) y, agotados los intentos, dejan la llamada
 * en un estado que una persona ve y puede reintentar con un boton.
 */
import { classifyPublishError } from "@/lib/jobs/errors";

export const AI_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export type AiFailureDecision =
  | { action: "retry"; delayMs: number; nextRetry: number }
  | { action: "give_up"; message: string; permanent: boolean };

/** `retry` es cuantas veces ya se reintento (0 la primera vez que falla). */
export function decideAiFailure(error: unknown, retry: number): AiFailureDecision {
  const classified = classifyPublishError(error);
  const message = classified.message.slice(0, 300) || "error desconocido";
  if (classified.kind === "permanent") return { action: "give_up", message, permanent: true };
  if (retry >= AI_RETRY_DELAYS_MS.length) return { action: "give_up", message, permanent: false };
  return { action: "retry", delayMs: AI_RETRY_DELAYS_MS[retry], nextRetry: retry + 1 };
}

/** Un error con esta marca no se reintenta nunca (por ejemplo, una respuesta cortada por largo). */
export function isTruncated(error: unknown): boolean {
  return error instanceof Error && error.name === "TruncatedOutputError";
}
