/**
 * El presupuesto de pedidos a Fathom por corrida (F8).
 *
 * Fathom no publica su limite (prevxcrm y el alcance usan 10 por minuto), asi
 * que cada corrida de un job `fathom_sync` gasta como maximo 9 pedidos
 * (1 lista + 8 transcripciones, o varias listas) y se reencola a los 70
 * segundos si le quedo trabajo. Puro: lo cuenta el, no el cliente de red.
 */

export const REQUEST_BUDGET = 9;
/** Cuanto espera la continuacion cuando se agoto el presupuesto. */
export const CONTINUATION_DELAY_MS = 70_000;
/** Si Fathom responde 429 sin `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
/** Tope de lo que se le hace caso a un `Retry-After`: mas que eso se reintenta en la proxima vuelta del cron. */
export const MAX_RETRY_AFTER_MS = 10 * 60_000;

export interface RequestBudget {
  /** Pide un pedido. false = se agoto el presupuesto: no se hace. */
  take(): boolean;
  readonly remaining: number;
  readonly used: number;
}

export function createRequestBudget(limit: number = REQUEST_BUDGET): RequestBudget {
  let used = 0;
  return {
    take() {
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    get remaining() {
      return limit - used;
    },
    get used() {
      return used;
    },
  };
}

/** El `Retry-After` de un 429 en milisegundos (segundos o fecha HTTP), con tope. */
export function retryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number {
  if (header == null || header.trim() === "") return DEFAULT_RETRY_AFTER_MS;
  const asSeconds = Number(header);
  let ms: number;
  if (Number.isFinite(asSeconds)) ms = asSeconds * 1000;
  else {
    const at = Date.parse(header);
    if (Number.isNaN(at)) return DEFAULT_RETRY_AFTER_MS;
    ms = at - nowMs;
  }
  return Math.min(Math.max(ms, 1_000), MAX_RETRY_AFTER_MS);
}
