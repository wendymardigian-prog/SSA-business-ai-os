/**
 * Cuantas veces pasó UNA cosa, según las `actions` de Meta (Tirón 2, E1).
 *
 * Meta devuelve el MISMO evento con varios nombres a la vez: un lead llega como `lead`, como
 * `onsite_conversion.lead_grouped`, como `offsite_complete_registration_add_meta_leads`… Sumar todo lo que «parezca» un
 * lead (lo que se hacía antes, buscando la palabra adentro del tipo) contaba cada lead hasta cinco veces: el sistema
 * guardaba 2.337 leads cuando Meta informa 468. La regla correcta es **un solo nombre por evento**: el primero de una
 * lista de preferencia que venga. `lead` es el que Meta usa como total.
 *
 * Hay dos formas de `actions`: la lista cruda que devuelve la API (`[{action_type, value}]`, al escribir) y el mapa que
 * se guarda (`{tipo: cantidad}`, al leer). Las dos usan la misma regla.
 *
 * `lib/meta/action-counts.cases.json` son los casos compartidos con la gemela en SQL (`00220_meta_leads_recount`): si
 * se cambia una regla, se cambia en las dos y se suma el caso.
 *
 * Módulo puro. Un evento que Meta no informa es `null` («—»), nunca 0.
 */

export interface ActionEntry {
  action_type?: string;
  value?: string | number;
}
export type ActionMap = Record<string, number>;

/** Los nombres con que Meta informa cada evento, del que vale (el primero que venga) al último. */
export const LEAD_ACTIONS = [
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
] as const;

export const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"] as const;
export const SCHEDULE_ACTIONS = ["omni_schedule", "schedule_total", "schedule", "offsite_conversion.fb_pixel_schedule"] as const;
export const VIEW_CONTENT_ACTIONS = ["omni_view_content", "view_content", "offsite_conversion.fb_pixel_view_content"] as const;
export const SUBMIT_APPLICATION_ACTIONS = ["omni_submit_application", "submit_application", "offsite_conversion.fb_pixel_submit_application"] as const;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** La lista cruda que devuelve la API, como mapa. Si un tipo se repite, se suma (es lo que hace Meta por plataforma). */
export function toActionMap(entries: ActionEntry[] | undefined | null): ActionMap {
  const map: ActionMap = {};
  for (const entry of entries ?? []) {
    if (!entry.action_type) continue;
    map[entry.action_type] = (map[entry.action_type] ?? 0) + (num(entry.value) ?? 0);
  }
  return map;
}

/**
 * Cuantas veces pasó el evento: el valor del primer nombre de `preference` que venga; si ninguno, el MAYOR de los que
 * coincidan con `fallback` (si es el mismo evento con otro nombre, el mayor es el total; nunca se suman). Null si no vino.
 */
export function canonicalCount(source: ActionEntry[] | ActionMap | undefined | null, preference: readonly string[], fallback?: RegExp): number | null {
  if (!source) return null;
  const map = Array.isArray(source) ? toActionMap(source) : source;
  for (const type of preference) {
    const value = map[type];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  if (fallback) {
    let best: number | null = null;
    for (const [type, value] of Object.entries(map)) {
      if (fallback.test(type) && Number.isFinite(value)) best = best === null ? value : Math.max(best, value);
    }
    return best;
  }
  return null;
}

export const countLeadActions = (source: ActionEntry[] | ActionMap | undefined | null) => canonicalCount(source, LEAD_ACTIONS);
export const countPurchaseActions = (source: ActionEntry[] | ActionMap | undefined | null) => canonicalCount(source, PURCHASE_ACTIONS);
export const countScheduleActions = (source: ActionEntry[] | ActionMap | undefined | null) => canonicalCount(source, SCHEDULE_ACTIONS, /schedule/i);
export const countViewContentActions = (source: ActionEntry[] | ActionMap | undefined | null) => canonicalCount(source, VIEW_CONTENT_ACTIONS);
export const countSubmitApplicationActions = (source: ActionEntry[] | ActionMap | undefined | null) => canonicalCount(source, SUBMIT_APPLICATION_ACTIONS);
