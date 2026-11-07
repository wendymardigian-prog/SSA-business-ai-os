/**
 * El catálogo de variables del Diseñador IA (F49, núcleo).
 *
 * Tres orígenes:
 *   1. Del sistema, con LAS MISMAS CLAVES que Automatizaciones
 *      (`lib/flow-engine/variable-catalog.ts`) para que un valor se mapee sin
 *      traducciones: Contacto y Negocio. Más las propias del Diseñador
 *      (`design.*`).
 *   2. Registradas por otros módulos (`registerDesignVariables`, en
 *      `../extensions.ts`): el punto de extensión que usa Servicios.
 *   3. Propias de la plantilla (`design_templates.custom_vars`), sin prefijo.
 *
 * En pantalla cada variable se ve con su nombre en español (un chip); en el
 * texto se guarda `{{clave}}`.
 *
 * Módulo puro. `resolveValues` (con la política si falta un dato) vive en
 * `./resolve.ts` (DS6).
 */

import { CONTACT_VARIABLES, WORKSPACE_VARIABLES } from "@/lib/flow-engine/variable-catalog";
import { registeredVariableGroups } from "../extensions";

export type VariableGroupKey = "propias" | "contacto" | "negocio" | "diseno" | string;

export interface DesignVariable {
  key: string;
  label: string;
  /** Valor de muestra para "Ver con datos de ejemplo". */
  sample: string;
}

export interface VariableGroup {
  key: VariableGroupKey;
  label: string;
  vars: DesignVariable[];
}

/** Contacto: mismas claves que Automatizaciones (si allá cambian, el test falla). */
export const CONTACT_DESIGN_VARIABLES: readonly DesignVariable[] = [
  { key: "contact.first_name", label: "Nombre", sample: "Ana" },
  { key: "contact.display_name", label: "Nombre completo", sample: "Ana Pérez" },
  { key: "contact.email", label: "Email", sample: "ana@ejemplo.com" },
  { key: "contact.phone", label: "Teléfono", sample: "+54 9 11 5555 5555" },
];

export const WORKSPACE_DESIGN_VARIABLES: readonly DesignVariable[] = [{ key: "workspace.name", label: "Nombre del negocio", sample: "Tu negocio" }];

/** Las propias del Diseñador IA. `design.doc_type` solo tiene sentido en plantillas con verificación (F47). */
export const DESIGN_SYSTEM_VARIABLES: readonly DesignVariable[] = [
  { key: "design.code", label: "Código de verificación", sample: "K8F2-WQ4M-7TQA" },
  { key: "design.doc_type", label: "Tipo de documento", sample: "Certificado" },
  { key: "design.issued_on", label: "Fecha de emisión", sample: "7 de noviembre de 2026" },
  { key: "design.today", label: "Fecha de hoy", sample: "7 de noviembre de 2026" },
];

/** Las claves del sistema que el Diseñador comparte con Automatizaciones. */
export const SHARED_SYSTEM_KEYS: readonly string[] = [...CONTACT_VARIABLES, ...WORKSPACE_VARIABLES];

export interface CustomVar {
  key: string;
  label: string;
  sample: string;
  default?: string | null;
}

export const CUSTOM_VAR_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * La clave de una variable propia a partir del nombre en español:
 * "Nombre en el certificado" → "nombre_en_el_certificado" (sin tildes, snake_case,
 * hasta 41 caracteres, empieza con una letra).
 */
export function customVarKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 41)
    .replace(/_+$/, "");
  return base.length >= 2 ? base : `dato_${base || "propio"}`.slice(0, 41);
}

/** Los grupos del menú "Insertar variable" (F24): Propias, Contacto, Negocio, Diseño y los registrados. */
export function variableGroups(opts: { customVars?: readonly CustomVar[]; verify?: boolean } = {}): VariableGroup[] {
  const groups: VariableGroup[] = [];
  const custom = (opts.customVars ?? []).filter((v) => CUSTOM_VAR_KEY_RE.test(v.key));
  if (custom.length) groups.push({ key: "propias", label: "Propias", vars: custom.map((v) => ({ key: v.key, label: v.label, sample: v.sample })) });
  groups.push({ key: "contacto", label: "Contacto", vars: [...CONTACT_DESIGN_VARIABLES] });
  groups.push({ key: "negocio", label: "Negocio", vars: [...WORKSPACE_DESIGN_VARIABLES] });
  groups.push({
    key: "diseno",
    label: "Diseño",
    vars: DESIGN_SYSTEM_VARIABLES.filter((v) => opts.verify || (v.key !== "design.code" && v.key !== "design.doc_type")),
  });
  for (const g of registeredVariableGroups()) groups.push({ key: g.group, label: g.label, vars: g.vars.map((v) => ({ ...v })) });
  return groups;
}

/** Cómo se ve una variable en un chip y en qué grupo está. Una clave desconocida se muestra tal cual. */
export function variableInfo(key: string, opts: { customVars?: readonly CustomVar[] } = {}): { label: string; group: string; sample: string; known: boolean } {
  for (const group of variableGroups({ customVars: opts.customVars, verify: true })) {
    const v = group.vars.find((x) => x.key === key);
    if (v) return { label: v.label, group: group.label, sample: v.sample, known: true };
  }
  return { label: key, group: "Desconocida", sample: "", known: false };
}

/** Los valores de muestra de todas las variables (para "Ver con datos de ejemplo" y "Exportar prueba"). */
export function sampleValues(opts: { customVars?: readonly CustomVar[]; workspaceName?: string } = {}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const group of variableGroups({ customVars: opts.customVars, verify: true })) for (const v of group.vars) values[v.key] = v.sample;
  if (opts.workspaceName) values["workspace.name"] = opts.workspaceName;
  for (const v of opts.customVars ?? []) values[v.key] = v.sample || v.default || v.label;
  return values;
}

export type DateFormat = "long" | "short" | "en";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  long: "7 de noviembre de 2026",
  short: "07/11/2026",
  en: "November 7, 2026",
};

/** Una fecha con el formato de la plantilla, en la zona del negocio (F28, F56). */
export function formatDesignDate(date: Date, format: DateFormat, timeZone: string): string {
  if (format === "short") {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(date);
  }
  if (format === "en") {
    return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
  }
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}
