/**
 * El estado visual de la ventana de un borrador (Bloque 2c). Puro, sin
 * dependencias: lo usan la cola, la conversacion y los tests.
 *
 * Cinco estados, derivados de la ventana del canal (W), nunca de constantes en
 * horas: con W = 24, los cortes son 12, 6 y 3 horas.
 *
 *   holgada          restante > W/2
 *   aviso            restante <= W/2   (mitad)
 *   urgente          restante <= W/4   (cuarto)
 *   ultima llamada   restante <= W/8   (octavo)
 *   cerrada          ya paso
 *
 * Un canal sin ventana (sendable_until null o W = 0) no tiene estado: ni
 * indicador ni alertas. "No enviable" no es un estado del borrador: es este
 * calculo en "closed".
 */

export type WindowLevel = "none" | "relaxed" | "warning" | "urgent" | "last_call" | "closed";

export interface WindowInfo {
  level: WindowLevel;
  /** Milisegundos que quedan (negativo si ya cerro). null sin ventana. */
  remainingMs: number | null;
}

/** Denominadores de los cortes: mitad, cuarto, octavo. Tambien son los de alerted_thresholds. */
export const WINDOW_THRESHOLDS = [2, 4, 8] as const;

export function windowInfo(sendableUntil: string | null | undefined, windowHours: number, now: Date = new Date()): WindowInfo {
  if (!sendableUntil || windowHours <= 0) return { level: "none", remainingMs: null };
  const remainingMs = new Date(sendableUntil).getTime() - now.getTime();
  if (Number.isNaN(remainingMs)) return { level: "none", remainingMs: null };
  if (remainingMs <= 0) return { level: "closed", remainingMs };
  const w = windowHours * 3_600_000;
  if (remainingMs <= w / 8) return { level: "last_call", remainingMs };
  if (remainingMs <= w / 4) return { level: "urgent", remainingMs };
  if (remainingMs <= w / 2) return { level: "warning", remainingMs };
  return { level: "relaxed", remainingMs };
}

/** "Por vencer": urgente o ultima llamada (menos de un cuarto de la ventana). */
export function isAboutToExpire(info: WindowInfo): boolean {
  return info.level === "urgent" || info.level === "last_call";
}

export const WINDOW_LEVEL_LABELS: Record<Exclude<WindowLevel, "none">, string> = {
  relaxed: "Con tiempo",
  warning: "Menos de la mitad",
  urgent: "Por vencer",
  last_call: "Última llamada",
  closed: "Ventana cerrada",
};

/** "quedan 5 h 20 min", "quedan 12 min", "cerró hace 2 h". */
export function formatRemaining(info: WindowInfo): string | null {
  if (info.remainingMs === null) return null;
  const abs = Math.abs(info.remainingMs);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const text = hours > 0 ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${Math.max(1, minutes)} min`;
  return info.remainingMs > 0 ? `quedan ${text}` : `cerró hace ${text}`;
}
