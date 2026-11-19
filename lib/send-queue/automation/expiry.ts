/**
 * La caducidad de un envío de la cola. PURO.
 *
 * Cada automatización elige cuánto puede esperar su mensaje: 5 minutos, 15, 1 hora, 4 horas, 24 horas o sin límite. Se
 * cuenta desde que el envío PUEDE salir (su hora prevista: al entrar en la cola, o la fecha de un envío programado). Lo
 * que no sale a tiempo queda «caducado» con su motivo, no se envía y suma al resumen del día.
 */

export const EXPIRY_OPTIONS = ["5m", "15m", "1h", "4h", "24h", "none"] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

export const EXPIRY_MINUTES: Record<Exclude<ExpiryOption, "none">, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "24h": 1440,
};

export const EXPIRY_LABELS: Record<ExpiryOption, string> = {
  "5m": "5 minutos",
  "15m": "15 minutos",
  "1h": "1 hora",
  "4h": "4 horas",
  "24h": "24 horas",
  none: "Sin límite",
};

/** Por defecto, sin límite: es lo más conservador (no se pierde ningún mensaje que alguien no pidió que caduque). */
export const DEFAULT_EXPIRY: ExpiryOption = "none";

export function parseExpiry(raw: unknown): ExpiryOption {
  return typeof raw === "string" && (EXPIRY_OPTIONS as readonly string[]).includes(raw) ? (raw as ExpiryOption) : DEFAULT_EXPIRY;
}

/** Hasta cuándo puede salir un envío que puede salir desde `from`. null = sin límite. */
export function expiresAtFor(option: ExpiryOption, from: Date): Date | null {
  if (option === "none") return null;
  return new Date(from.getTime() + EXPIRY_MINUTES[option] * 60_000);
}

/** ¿Ya caducó? */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** ¿Caduca antes del próximo hueco en el que podría salir? (lo urgente con la reserva gastada). */
export function expiresBefore(expiresAt: Date | null, slot: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= slot.getTime();
}
