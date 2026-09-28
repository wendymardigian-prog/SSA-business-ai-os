/**
 * Como se clasifican los errores de Google Calendar (F6).
 *
 * Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License,
 * Copyright (c) 2020-present Cal.com, Inc. (la tabla de codigos de
 * CalendarService); la clasificacion sigue la guia de errores de Google
 * (developers.google.com/calendar/api/guides/errors, 27/9/2026):
 *
 *   - temporary: se reintenta con espera. 429, 5xx, errores de red y los 403
 *     de cuota (`rateLimitExceeded`, `userRateLimitExceeded`).
 *   - permanent: reintentar no sirve. 401 e `invalid_grant` (hay que
 *     reconectar), 403 por permisos (`insufficientPermissions`,
 *     `forbiddenForNonOrganizer`), 400.
 *   - not_found: 404 y 410. Al borrar se tratan como exito (ya no esta).
 */

export type GoogleErrorKind = "temporary" | "permanent" | "not_found";

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
    readonly status: number | null,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

const TEMPORARY_403 = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

/** Que motivo trae el cuerpo de error de Google, si trae alguno. */
export function googleErrorReason(body: unknown): string | null {
  const b = body as { error?: { errors?: Array<{ reason?: string }>; status?: string; message?: string } | string } | null;
  if (!b || typeof b !== "object") return null;
  if (typeof b.error === "string") return b.error;
  const first = b.error?.errors?.[0]?.reason;
  return first ?? b.error?.status ?? null;
}

export function classifyGoogleError(input: {
  status: number | null;
  reason?: string | null;
  /** true cuando `fetch` lanzo (sin respuesta). */
  network?: boolean;
}): GoogleErrorKind {
  if (input.network || input.status === null) return "temporary";
  const { status } = input;
  const reason = input.reason ?? null;
  if (reason === "invalid_grant") return "permanent";
  if (status === 404 || status === 410) return "not_found";
  if (status === 429 || status >= 500) return "temporary";
  if (status === 403) return reason && TEMPORARY_403.has(reason) ? "temporary" : "permanent";
  return "permanent";
}

export function toGoogleCalendarError(input: {
  status: number | null;
  body?: unknown;
  network?: boolean;
  fallbackMessage: string;
}): GoogleCalendarError {
  const reason = googleErrorReason(input.body);
  const kind = classifyGoogleError({ status: input.status, reason, network: input.network });
  const message =
    (input.body as { error?: { message?: string } } | null)?.error?.message ??
    (input.status ? `${input.fallbackMessage} (Google respondio ${input.status})` : input.fallbackMessage);
  return new GoogleCalendarError(message, kind, input.status, reason);
}
