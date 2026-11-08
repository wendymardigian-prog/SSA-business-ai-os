/**
 * Las variables propias de una plantilla, del lado de generar (F49, F50).
 *
 * La forma de cada clave, que no choque con una del sistema y que no se repita la valida `validateCustomVars`
 * (`../screens/variables`, la misma que exige el servidor al guardar la plantilla): acá no hay una segunda regla. Esto es lo
 * que hace falta para generar:
 *
 *   - leer `design_templates.custom_vars` tal como viene de la base (solo lo que tiene la forma esperada);
 *   - cuáles son obligatorias (las que el documento usa y no tienen valor por defecto);
 *   - limpiar lo que manda el navegador como «valores puestos a mano»: solo claves conocidas, solo texto, con tope de largo.
 *
 * Módulo puro.
 */

import { validateCustomVars } from "../screens/variables";
import { ALWAYS_RESOLVED_KEYS } from "./resolve";
import { CUSTOM_VAR_KEY_RE, type CustomVar } from "./catalog";

export { validateCustomVars };

/** El largo máximo de un valor puesto a mano (un nombre, una frase corta; nunca un párrafo). */
export const MAX_OVERRIDE_LENGTH = 300;
/** Cuántos valores a mano acepta una sola generación. */
export const MAX_OVERRIDES = 60;

/** `custom_vars` de la base: las entradas con la forma esperada, en orden. Algo raro es «sin variables». */
export function parseCustomVarsList(raw: unknown): CustomVar[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomVar[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.key !== "string" || !CUSTOM_VAR_KEY_RE.test(v.key) || typeof v.label !== "string") continue;
    if (out.some((x) => x.key === v.key)) continue;
    out.push({ key: v.key, label: v.label, sample: typeof v.sample === "string" ? v.sample : "", default: typeof v.default === "string" ? v.default : null });
  }
  return out;
}

/**
 * Las variables propias que la persona tiene que completar: las que el documento usa y no traen un valor por defecto
 * (F50: «propia sin valor y sin defecto»). Las que no se usan en ningún texto no se piden.
 */
export function requiredCustomVars(customVars: readonly CustomVar[], docKeys: readonly string[]): CustomVar[] {
  const used = new Set(docKeys);
  return customVars.filter((v) => used.has(v.key) && !(typeof v.default === "string" && v.default.trim() !== ""));
}

/** Las claves que un valor a mano puede tener: las propias de la plantilla, las del sistema y las de un módulo registrado. */
export function allowedOverrideKeys(customVars: readonly CustomVar[], registeredKeys: readonly string[] = []): Set<string> {
  return new Set([...customVars.map((v) => v.key), ...ALWAYS_RESOLVED_KEYS, ...registeredKeys]);
}

export type OverridesResult = { ok: true; overrides: Record<string, string> } | { ok: false; error: string };

/**
 * Los valores puestos a mano, limpios. `design.code` no se puede pisar (lo asigna la base y es el mismo del link);
 * una clave que no es de la plantilla ni del sistema se descarta; un valor largo o que no es texto se rechaza.
 */
export function sanitizeOverrides(raw: unknown, allowed: ReadonlySet<string>): OverridesResult {
  if (raw === undefined || raw === null) return { ok: true, overrides: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Los datos de la pieza no tienen la forma esperada." };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_OVERRIDES) return { ok: false, error: "Son demasiados datos para una sola pieza." };
  const overrides: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key === "design.code" || !allowed.has(key)) continue;
    if (typeof value !== "string") return { ok: false, error: "Un dato de la pieza no es texto." };
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length > MAX_OVERRIDE_LENGTH) return { ok: false, error: `Un dato es demasiado largo (hasta ${MAX_OVERRIDE_LENGTH} caracteres).` };
    if (text) overrides[key] = text;
  }
  return { ok: true, overrides };
}
