/**
 * Lógica de las tarjetas del dashboard (F16): comparación con el período
 * anterior y color de "Primera respuesta". Pura y testeable.
 */

export interface Comparison {
  current: number;
  previous: number | null;
  /** Diferencia absoluta; null si no hay período anterior. */
  delta: number | null;
  /** "up" | "down" | "flat" | null. */
  direction: "up" | "down" | "flat" | null;
}

export function compare(current: number, previous: number | null): Comparison {
  if (previous === null) return { current, previous: null, delta: null, direction: null };
  const delta = current - previous;
  return { current, previous, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

/**
 * Color de la tarjeta "Primera respuesta": bajar (responder más rápido) es
 * bueno → verde; subir es malo → ámbar. Sin comparación → neutro.
 */
export function firstResponseTone(comp: Comparison): "good" | "bad" | "neutral" {
  if (comp.direction === null || comp.direction === "flat") return "neutral";
  return comp.direction === "down" ? "good" : "bad";
}

/** Formatea segundos como "45 s", "3 min", "2 h 10 min". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}
