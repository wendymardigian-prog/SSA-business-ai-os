// @plantilla-quitar(servicios)
/**
 * Disparadores relativos y periódicos del servicio (Servicios A4, F158). PURA.
 *
 * Gemela de `app_servicio.svc_relative_due(jsonb)` (00372), con `relative-triggers.cases.json` (vitest y
 * `verify-services --bloque a4`). Los emite `svc_daily_run`, una vez por disparador, servicio y día.
 *
 *   service_relative       «X días antes o después de…»: el ancla es la creación del servicio, su inicio, su fin, el
 *                          inicio de una fase o completar un paso; desplazamiento de −365 a +365. Emite el día exacto.
 *   service_phase_periodic «Cada N días mientras esté en la fase…»: N de 1 a 90, en días DE LA FASE sin pausas (el mismo
 *                          conteo que el semáforo: reanudar corre el inicio de la fase). La primera vez es el día N,
 *                          nunca el 0. Se detiene sola al cambiar de fase.
 *
 * Un servicio pausado (o que no está activo) no emite. Un ancla que todavía no ocurrió no emite. No hay recuperación
 * de días pasados: un disparador nuevo o editado no emite por días que ya pasaron.
 */

export const RELATIVE_ANCHORS = ["service_created", "service_start", "service_end", "phase_start", "item_completed"] as const;
export type RelativeAnchor = (typeof RELATIVE_ANCHORS)[number];
export const PERIODIC_PRESETS = [1, 7, 15, 30] as const;

export type RelativeDueInput = {
  kind: "relative" | "periodic";
  /** relative */
  anchor?: RelativeAnchor | null;
  offset_days?: number | null;
  /** periodic */
  every_days?: number | null;
  status: string;
  today: string;
  /** La fecha del ancla (ya resuelta para la fase o el paso del disparador), o null si no ocurrió. */
  anchor_on?: string | null;
  /** periodic: la fase en curso y su inicio (corrido por las pausas). */
  current_phase_key?: string | null;
  current_phase_started_on?: string | null;
  /** periodic: la fase del disparador. */
  phase_key?: string | null;
};

export type RelativeDue = { due: false } | { due: true; day: string; phase_day: number | null };

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);

export function relativeDue(i: RelativeDueInput): RelativeDue {
  if (i.status !== "active") return { due: false };
  if (i.kind === "relative") {
    const off = Number(i.offset_days);
    if (!i.anchor_on || !Number.isInteger(off) || off < -365 || off > 365) return { due: false };
    return addDays(i.anchor_on, off) === i.today ? { due: true, day: i.today, phase_day: null } : { due: false };
  }
  const every = Number(i.every_days);
  if (!Number.isInteger(every) || every < 1 || every > 90) return { due: false };
  if (!i.phase_key || i.current_phase_key !== i.phase_key || !i.current_phase_started_on) return { due: false };
  const day = Math.round((toMs(i.today) - toMs(i.current_phase_started_on)) / DAY_MS);
  if (day < every || day % every !== 0) return { due: false };
  return { due: true, day: i.today, phase_day: day };
}

export type RelativeTriggerConfig = {
  anchor: RelativeAnchor;
  phase_key?: string | null;
  item_key?: string | null;
  offset_days: number;
  product_id?: string | null;
  variant_id?: string | null;
};
export type PeriodicTriggerConfig = { phase_key: string; every_days: number; product_id?: string | null; variant_id?: string | null };

/** Los problemas de la configuración de un disparador relativo (para publicar). */
export function relativeConfigProblems(c: Partial<RelativeTriggerConfig>): string[] {
  const p: string[] = [];
  if (!c.anchor || !(RELATIVE_ANCHORS as readonly string[]).includes(c.anchor)) p.push("Elegí desde qué momento se cuenta.");
  if (c.anchor === "phase_start" && !c.phase_key) p.push("Elegí la fase.");
  if (c.anchor === "item_completed" && !c.item_key) p.push("Elegí el paso.");
  const off = Number(c.offset_days);
  if (!Number.isInteger(off) || off < -365 || off > 365) p.push("Los días van de −365 a 365.");
  return p;
}

export function periodicConfigProblems(c: Partial<PeriodicTriggerConfig>): string[] {
  const p: string[] = [];
  if (!c.phase_key) p.push("Elegí la fase.");
  const n = Number(c.every_days);
  if (!Number.isInteger(n) || n < 1 || n > 90) p.push("Cada cuántos días: de 1 a 90.");
  return p;
}

/** La frase del disparador, para el lienzo y la lista. */
export function relativeTriggerLabel(c: Partial<RelativeTriggerConfig>, names: { phase?: string | null; item?: string | null } = {}): string {
  const off = Number(c.offset_days) || 0;
  const what =
    c.anchor === "service_created" ? "la creación del servicio"
    : c.anchor === "service_start" ? "el inicio del servicio"
    : c.anchor === "service_end" ? "el fin del servicio"
    : c.anchor === "phase_start" ? `el inicio de la fase ${names.phase ? `«${names.phase}»` : ""}`.trim()
    : c.anchor === "item_completed" ? `completar ${names.item ? `«${names.item}»` : "el paso"}`
    : "…";
  const de = what.startsWith("el ") ? `del ${what.slice(3)}` : `de ${what}`;
  if (off === 0) return `El día ${de}`;
  return `${Math.abs(off)} día(s) ${off < 0 ? "antes" : "después"} ${de}`;
}
