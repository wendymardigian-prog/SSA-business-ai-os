/**
 * Que clase de error es, para saber si vale la pena reintentar (F30).
 *
 * La distincion decide si una publicacion se vuelve a intentar o se da por
 * perdida. Equivocarse en cualquiera de las dos direcciones cuesta:
 * reintentar un token vencido es golpear una puerta cerrada tres veces, y NO
 * reintentar un corte de red de dos segundos es perder una publicacion que
 * habria salido bien.
 */

export type ErrorKind = "temporary" | "permanent";

export class PublishError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    /** Codigo del proveedor, para el log. */
    readonly code?: string | number,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/** Codigos que siempre son temporales, pase lo que pase. */
const TEMPORARY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Clasifica un error de un proveedor.
 *
 * - Sin respuesta (la red se corto): temporal. No se sabe si llego, pero
 *   tampoco se sabe que fallo definitivamente.
 * - 429 y 5xx: temporal.
 * - 401 y 403: permanente. El token no se arregla solo.
 * - 4xx de validacion: permanente. El mismo pedido va a fallar igual.
 */
export function classifyPublishError(error: unknown): PublishError {
  if (error instanceof PublishError) return error;

  const status = extractStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status === null) {
    // Sin status: o es un corte de red o es un error nuestro. Se trata como
    // temporal salvo que el mensaje diga otra cosa.
    return new PublishError(message, looksPermanent(message) ? "permanent" : "temporary");
  }

  if (TEMPORARY_STATUS.has(status)) {
    return new PublishError(message, "temporary", status);
  }

  if (status === 401 || status === 403) {
    return new PublishError(message, "permanent", status);
  }

  if (status >= 400 && status < 500) {
    return new PublishError(message, "permanent", status);
  }

  return new PublishError(message, "temporary", status);
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const value of [candidate.status, candidate.statusCode, candidate.code]) {
    if (typeof value === "number" && value >= 100 && value < 600) return value;
  }
  return null;
}

/** Mensajes que delatan un problema que no se arregla reintentando. */
function looksPermanent(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "invalid_grant",
    "unauthorized",
    "invalid api key",
    "permission",
    "not found",
    "unsupported",
    "too large",
    "duration",
  ].some((needle) => lower.includes(needle));
}

/** El mensaje que ve una persona. Sin codigos ni jerga del proveedor. */
export function humanizePublishError(error: PublishError, platform: string): string {
  if (error.kind === "temporary") {
    return `${platform} no respondio bien en este intento. Se va a reintentar solo.`;
  }

  const lower = error.message.toLowerCase();
  if (lower.includes("invalid_grant") || error.code === 401) {
    return `Se corto el acceso a ${platform}. Reconectalo en Integraciones.`;
  }
  if (error.code === 403 || lower.includes("permission")) {
    return `Falta un permiso en ${platform}. Reconectalo aceptando todos los permisos.`;
  }
  return `${platform} rechazo la publicacion: ${error.message}`;
}
