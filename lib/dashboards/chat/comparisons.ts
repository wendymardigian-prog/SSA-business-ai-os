/**
 * Como se lee una comparacion con el periodo anterior.
 *
 * Tres reglas:
 *
 *   1. **En porcentaje, no en diferencia absoluta.** "▲ 3" no dice nada si no se
 *      sabe si era 4 o 400. La version anterior mostraba la diferencia.
 *   2. **Sin periodo anterior se dice.** En Historico no hay con que comparar:
 *      "Sin datos del período anterior", nunca un 0 %.
 *   3. **Subir no siempre es bueno.** En primera respuesta y en "Derivó", bajar
 *      es lo bueno. El color sale de la metrica, no del signo.
 */

/** Para que metrica se compara: define que color es "bueno". */
export type MetricDirection = "more-is-better" | "less-is-better";

export interface Comparison {
  /** Cambio en porcentaje, redondeado. null = no hay con que comparar. */
  percent: number | null;
  /** Cambio en puntos porcentuales (para las tasas del agente). */
  points: number | null;
  /** "up" | "down" | "flat" | null. */
  direction: "up" | "down" | "flat" | null;
  /** Si el cambio es bueno, malo o neutro para esta metrica. */
  tone: "good" | "bad" | "neutral";
  /** El texto listo para la tarjeta. */
  label: string;
}

const NO_PREVIOUS = "Sin datos del período anterior";

function toneFor(direction: "up" | "down" | "flat" | null, metric: MetricDirection): "good" | "bad" | "neutral" {
  if (direction === null || direction === "flat") return "neutral";
  const good = metric === "more-is-better" ? direction === "up" : direction === "down";
  return good ? "good" : "bad";
}

/**
 * Compara dos valores del mismo largo de periodo.
 *
 * `previous` en null (Historico) o en 0 no da porcentaje: dividir por cero no es
 * "creció infinito", es que no se puede comparar.
 */
export function comparePercent(
  current: number | null,
  previous: number | null,
  metric: MetricDirection = "more-is-better",
): Comparison {
  if (current === null || previous === null || previous === 0 || !Number.isFinite(previous)) {
    return { percent: null, points: null, direction: null, tone: "neutral", label: NO_PREVIOUS };
  }
  const raw = ((current - previous) / previous) * 100;
  const percent = Math.round(raw);
  const direction = percent > 0 ? "up" : percent < 0 ? "down" : "flat";
  const tone = toneFor(direction, metric);
  return {
    percent,
    points: null,
    direction,
    tone,
    label: `${percent > 0 ? "▲" : percent < 0 ? "▼" : "="} ${Math.abs(percent)} % vs. período anterior`,
  };
}

/**
 * Compara dos tasas en PUNTOS, no en porcentaje del porcentaje.
 *
 * De 20 % a 17 % son 3 puntos menos. Decir "bajó 15 %" es cierto y confuso.
 */
export function comparePoints(
  current: number | null,
  previous: number | null,
  metric: MetricDirection = "more-is-better",
): Comparison {
  if (current === null || previous === null) {
    return { percent: null, points: null, direction: null, tone: "neutral", label: NO_PREVIOUS };
  }
  const points = Math.round(current - previous);
  const direction = points > 0 ? "up" : points < 0 ? "down" : "flat";
  const tone = toneFor(direction, metric);
  return {
    percent: null,
    points,
    direction,
    tone,
    label: `${points > 0 ? "▲" : points < 0 ? "▼" : "="} ${Math.abs(points)} pts vs. período anterior`,
  };
}

/** Un porcentaje sobre un total. Sin total no es 0 %: es una raya. */
export function share(part: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round((part / total) * 100);
}

/** Un numero con separador de miles en castellano. */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("es-AR");
}

/** Una duracion en segundos, legible. Null = no se sabe, y se dibuja como raya. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Hace cuanto se cargo, en palabras. Se calcula en el navegador, no al render. */
export function formatAgo(loadedAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(loadedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Actualizado ahora";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Actualizado hace menos de un minuto";
  if (min === 1) return "Actualizado hace 1 minuto";
  if (min < 60) return `Actualizado hace ${min} minutos`;
  const h = Math.floor(min / 60);
  return h === 1 ? "Actualizado hace 1 hora" : `Actualizado hace ${h} horas`;
}
