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
 *
 * En HORAS (traído de RER, 00460): `unit: "hours"` con `offset_hours` de −720 a 720 (el de días guarda `offset_days`;
 * el de horas no lo lleva, así el barrido diario no lo toma). Lo emite `app_servicio.svc_relative_hours_tick`, desde el
 * cron horario `svc-daily`: sale si su hora llegó hace menos de 2 h (lo que nace vencido no se manda). Un solo envío
 * por automatización, servicio y ancla (`app_servicio.trigger_anchor_fires`, por `flow_id`: republicar no repite).
 * El inicio cuenta desde las 00:00 del día de inicio y el fin desde las 24:00 del último día (hora del negocio). «Antes»
 * solo con el inicio y el fin: son las únicas anclas que se conocen de antemano. Gemela: `svc_relative_hours_due`, con
 * `relative-hours.cases.json`.
 */

export const RELATIVE_ANCHORS = ["service_created", "service_start", "service_end", "phase_start", "item_completed"] as const;
export type RelativeAnchor = (typeof RELATIVE_ANCHORS)[number];
export const PERIODIC_PRESETS = [1, 7, 15, 30] as const;
/** Las anclas que se conocen de antemano: las únicas que admiten «antes». */
export const ANCHORS_KNOWN_AHEAD: readonly RelativeAnchor[] = ["service_start", "service_end"];
export const RELATIVE_UNITS = ["days", "hours"] as const;
export type RelativeUnit = (typeof RELATIVE_UNITS)[number];
export const MAX_OFFSET_HOURS = 720;
/** Cuánto tarde puede salir uno de horas (el cron pasa una vez por hora). Igual que «En una fecha y hora». */
export const HOURS_GRACE_MS = 2 * 60 * 60 * 1000;

/** Si uno de horas sale ahora: ya llegó su hora y no pasaron más de 2 h. Gemela de `svc_relative_hours_due`. */
export function relativeHoursDue(anchorAtMs: number, offsetHours: number, nowMs: number): boolean {
  if (!Number.isFinite(anchorAtMs) || !Number.isInteger(offsetHours) || Math.abs(offsetHours) > MAX_OFFSET_HOURS) return false;
  const due = anchorAtMs + offsetHours * 3_600_000;
  return due <= nowMs && due > nowMs - HOURS_GRACE_MS;
}

export const relativeUnit = (c: { unit?: unknown }): RelativeUnit => (c.unit === "hours" ? "hours" : "days");

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
  /** En horas (00460): `unit: "hours"` y `offset_hours`, sin `offset_days`. */
  unit?: RelativeUnit | null;
  offset_hours?: number | null;
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
  if (c.unit != null && !(RELATIVE_UNITS as readonly string[]).includes(String(c.unit))) p.push("Elegí días u horas.");
  const hours = relativeUnit(c) === "hours";
  const raw = hours ? c.offset_hours : c.offset_days;
  // Vacío no es 0: sin el número guardado, la base no lo emite nunca.
  const off = typeof raw === "number" ? raw : Number.NaN;
  const max = hours ? MAX_OFFSET_HOURS : 365;
  if (!Number.isInteger(off) || off < -max || off > max) p.push(hours ? `Las horas van de −${max} a ${max}.` : "Los días van de −365 a 365.");
  else if (off < 0 && c.anchor && !ANCHORS_KNOWN_AHEAD.includes(c.anchor)) p.push("«Antes» solo con el inicio o el fin del servicio: lo demás no se sabe de antemano.");
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
  const hours = relativeUnit(c) === "hours";
  const off = Number(hours ? c.offset_hours : c.offset_days) || 0;
  const what =
    c.anchor === "service_created" ? "la creación del servicio"
    : c.anchor === "service_start" ? "el inicio del servicio"
    : c.anchor === "service_end" ? "el fin del servicio"
    : c.anchor === "phase_start" ? `el inicio de la fase ${names.phase ? `«${names.phase}»` : ""}`.trim()
    : c.anchor === "item_completed" ? `completar ${names.item ? `«${names.item}»` : "el paso"}`
    : "…";
  const de = what.startsWith("el ") ? `del ${what.slice(3)}` : `de ${what}`;
  if (off === 0) return hours ? `En el momento ${de}` : `El día ${de}`;
  return `${Math.abs(off)} ${hours ? "hora(s)" : "día(s)"} ${off < 0 ? "antes" : "después"} ${de}`;
}
