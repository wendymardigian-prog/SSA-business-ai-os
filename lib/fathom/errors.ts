/**
 * Los errores de hablar con Fathom, con una sola pregunta importante:
 * ¿se arregla esperando (`temporary`) o hay que reconectar (`permanent`)?
 *
 * Un 429 o un 5xx NUNCA matan una conexion (leccion de prevxcrm del 8/8): se
 * reintenta en la proxima vuelta del cron.
 */

export type FathomErrorKind = "permanent" | "temporary";

export class FathomError extends Error {
  constructor(
    message: string,
    readonly kind: FathomErrorKind,
    readonly status: number | null = null,
    readonly code: string | null = null,
    /** Cuanto pidio esperar Fathom en un 429, si lo dijo. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "FathomError";
  }

  get isTemporary(): boolean {
    return this.kind === "temporary";
  }
}

export function isFathomError(err: unknown): err is FathomError {
  return err instanceof FathomError;
}
