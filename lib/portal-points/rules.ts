// @plantilla-quitar(servicios)
/**
 * Puntos del portal (F129, decisión 468; F245 a F249 del portal), puro. Gemelas de `app_servicio.points_for`,
 * `app_servicio.level_of` y `app_servicio.points_settings_problems` (00378); los casos de `points.cases.json` corren
 * contra las dos.
 *
 * Los valores por defecto del programa salen de F245. Un programa con `points.enabled` distinto de true NO suma nada
 * (los puntos nacen apagados: condición de Wendy, 14/11). El valor propio del paso, la fase o la actividad gana al del
 * programa.
 */

export const POINT_EVENTS = {
  lesson: { group: "cont", points: 1, label: "Ver o marcar una clase" },
  module: { group: "cont", points: 1, label: "Terminar un módulo" },
  all_content: { group: "cont", points: 10, label: "Terminar todo el contenido" },
  step: { group: "camino", points: 10, label: "Completar un paso" },
  phase: { group: "camino", points: 20, label: "Completar una fase" },
  journey: { group: "camino", points: 100, label: "Completar todo el camino" },
  submit: { group: "act", points: 5, label: "Entregar una actividad" },
  pass: { group: "act", points: 10, label: "Actividad aprobada" },
  quiz_pass: { group: "act", points: 5, label: "Aprobar una evaluación" },
  attendance: { group: "clases", points: 5, label: "Asistir a una clase en vivo" },
  post: { group: "com", points: 2, label: "Publicar en la comunidad" },
  comment: { group: "com", points: 1, label: "Comentar" },
  like: { group: "com", points: 1, label: "Cada «me gusta» que recibe" },
  ref_lead: { group: "ref", points: 10, label: "Un lead con su código" },
  ref_booking: { group: "ref", points: 25, label: "Su referido agenda" },
  ref_sale: { group: "ref", points: 100, label: "Su referido compra" },
} as const;
export type PointEvent = keyof typeof POINT_EVENTS;

export const POINT_GROUPS = [
  { key: "cont", label: "Contenido" },
  { key: "act", label: "Actividades" },
  { key: "camino", label: "Mi camino" },
  { key: "clases", label: "Clases en vivo" },
  { key: "com", label: "Comunidad" },
  { key: "proy", label: "Proyectos y pagos" },
  { key: "ref", label: "Referidos" },
  { key: "equipo", label: "Ajuste del equipo" },
] as const;

/** Topes por día (en la zona del estudiante). null = sin tope. */
export const DEFAULT_CAPS = { post: 1, comment: 10 } as const;

export const DEFAULT_LEVELS = [
  { name: "Explorador", min: 0 },
  { name: "Aprendiz", min: 10 },
  { name: "Constructor", min: 30 },
  { name: "Builder", min: 60 },
  { name: "Builder Pro", min: 100 },
  { name: "Arquitecto", min: 160 },
  { name: "Experto", min: 250 },
  { name: "Maestro", min: 400 },
  { name: "Leyenda", min: 600 },
] as const;

export interface PointsSettings {
  enabled?: boolean;
  values?: Partial<Record<PointEvent, number>>;
  caps?: { post?: number | null; comment?: number | null };
  levels?: Array<{ name: string; min: number }>;
  ranking?: { visible?: boolean };
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const MAX = 10000;

/**
 * Cuántos puntos y de qué grupo. 0 si el programa no tiene los puntos prendidos o el evento no existe. `override` es el
 * valor del paso, la fase o la actividad (null = el del programa).
 */
export function pointsFor(event: string, settings: PointsSettings | null | undefined, override?: number | null): { points: number; group: string | null } {
  const e = (POINT_EVENTS as Record<string, { group: string; points: number }>)[event];
  if (!e) return { points: 0, group: null };
  if (!settings || settings.enabled !== true) return { points: 0, group: e.group };
  if (isInt(override) && override >= 0 && override <= MAX) return { points: override, group: e.group };
  const v = settings.values?.[event as PointEvent];
  return { points: isInt(v) && v >= 0 && v <= MAX ? v : e.points, group: e.group };
}

/** El tope de un día para publicar o comentar. null = sin tope. */
export function dailyCap(event: string, settings: PointsSettings | null | undefined): number | null {
  if (event !== "post" && event !== "comment") return null;
  const caps = settings?.caps;
  if (caps && Object.prototype.hasOwnProperty.call(caps, event)) {
    const v = caps[event];
    return v === null ? null : isInt(v) && v >= 0 ? v : DEFAULT_CAPS[event];
  }
  return DEFAULT_CAPS[event];
}

/** El nivel (1 a 9) con los puntos históricos del programa. */
export function levelOf(total: number, levels?: PointsSettings["levels"] | null): { level: number; name: string; min: number; next: number | null } {
  const ls = levels && levels.length === 9 ? levels : DEFAULT_LEVELS;
  let i = 0;
  for (let k = 0; k < ls.length; k++) if (total >= ls[k].min) i = k;
  return { level: i + 1, name: ls[i].name, min: ls[i].min, next: i < ls.length - 1 ? ls[i + 1].min : null };
}

/** Lo que se revisa al guardar `portal_settings.points`. */
export function pointsSettingsProblems(p: unknown): string[] {
  if (p === null || p === undefined) return [];
  if (typeof p !== "object" || Array.isArray(p)) return ["los puntos no son válidos"];
  const s = p as Record<string, unknown>;
  const out: string[] = [];
  const known = ["enabled", "values", "caps", "levels", "ranking"];
  for (const k of Object.keys(s)) if (!known.includes(k)) out.push(`clave desconocida: ${k}`);
  if (s.enabled !== undefined && typeof s.enabled !== "boolean") out.push("prender los puntos tiene que ser sí o no");
  if (s.values !== undefined) {
    const v = s.values as Record<string, unknown>;
    if (typeof v !== "object" || v === null || Array.isArray(v) || Object.entries(v).some(([k, x]) => !(k in POINT_EVENTS) || !(isInt(x) && x >= 0 && x <= MAX))) {
      out.push("cada valor de puntos va de 0 a 10.000");
    }
  }
  if (s.caps !== undefined) {
    const c = s.caps as Record<string, unknown>;
    if (typeof c !== "object" || c === null || Array.isArray(c) || Object.entries(c).some(([k, x]) => !["post", "comment"].includes(k) || !(x === null || (isInt(x) && x >= 0 && x <= 100)))) {
      out.push("los topes por día van de 0 a 100, o sin tope");
    }
  }
  if (s.levels !== undefined) {
    const l = s.levels;
    const ok =
      Array.isArray(l) && l.length === 9 &&
      l.every((x, i) => typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string" && (x as { name: string }).name.trim() !== "" && (x as { name: string }).name.length <= 40 &&
        isInt((x as { min?: unknown }).min) && (i === 0 ? (x as { min: number }).min === 0 : (x as { min: number }).min > (l[i - 1] as { min: number }).min));
    if (!ok) out.push("los 9 niveles necesitan nombre y un mínimo que crezca, empezando en 0");
  }
  if (s.ranking !== undefined) {
    const r = s.ranking as Record<string, unknown>;
    if (typeof r !== "object" || r === null || Array.isArray(r) || Object.keys(r).some((k) => k !== "visible") || (r.visible !== undefined && typeof r.visible !== "boolean")) out.push("el ranking no es válido");
  }
  return out;
}
