/**
 * Los valores de las variables de una pieza (F49, F55, F56).
 *
 * `resolveValues` junta, para UNA generación, el valor de cada variable que usa la plantilla:
 *
 *   1. lo que se pasa (a mano en «Emitir…», o lo que arma el paso de la automatización);
 *   2. lo del sujeto (el contacto, el negocio, lo que resuelve un módulo registrado);
 *   3. el valor por defecto de la variable propia.
 *
 * Las variables del propio Diseñador (`design.*`) las pone el sistema: la fecha de emisión y la de hoy salen de la fecha
 * de creación en la zona del NEGOCIO (nunca la del navegador) con el formato de la plantilla; el tipo de documento sale del
 * tipo de la plantilla; el código lo asigna la base al crear la fila (se completa después, F56) y nunca «falta».
 *
 * Lo que sigue sin valor es un dato que falta, y manda la política (F55):
 *   - `fail`: «No generar y avisarme» (por defecto en automatizaciones): la pieza queda fallida con «Falta: …».
 *   - `template_default`: «Usar el valor de la plantilla»: la variable propia toma su valor de ejemplo (el que la plantilla
 *     muestra); las del contacto o de un módulo, que no tienen valor de plantilla, quedan vacías. Nunca se inventa el nombre
 *     de otra persona.
 *   - `empty`: «Dejarlo vacío».
 *
 * Módulo puro: no toca la base ni el reloj (la fecha llega por parámetro). Los casos de las tres políticas están en
 * `missing.cases.json`.
 */

import type { MissingPolicy } from "../contracts";
import { firstNameOf } from "@/lib/flow-engine/variable-catalog";
import { docTypeVariable } from "../verification";
import { formatDesignDate, variableInfo, type CustomVar, type DateFormat } from "./catalog";

/** El texto de la falla cuando falta un dato: «Falta: Nombre como lo quiere en el certificado». */
export const MISSING_PREFIX = "Falta: ";

export const MISSING_POLICIES: readonly MissingPolicy[] = ["fail", "template_default", "empty"];

/** Cómo se llama cada política en pantalla (F55). */
export const MISSING_POLICY_LABELS: Record<MissingPolicy, string> = {
  fail: "No generar y avisarme",
  template_default: "Usar el valor de la plantilla",
  empty: "Dejarlo vacío",
};

export function isMissingPolicy(value: unknown): value is MissingPolicy {
  return typeof value === "string" && (MISSING_POLICIES as readonly string[]).includes(value);
}

/** Las variables que pone el sistema y que nunca faltan. */
const SYSTEM_KEYS = new Set(["workspace.name", "design.code", "design.doc_type", "design.issued_on", "design.today"]);
const CONTACT_KEYS = ["contact.first_name", "contact.display_name", "contact.email", "contact.phone"] as const;

/** Las claves que siempre se calculan y se guardan (el email y «Detalle» las usan aunque la plantilla no las muestre). */
export const ALWAYS_RESOLVED_KEYS: readonly string[] = [...CONTACT_KEYS, "workspace.name", "design.code", "design.doc_type", "design.issued_on", "design.today"];

export interface ResolveTemplate {
  /** Las variables que usa el documento (`docVariables`). Solo estas pueden «faltar». */
  docKeys: readonly string[];
  customVars: readonly CustomVar[];
  dateFormat: DateFormat;
  verify: boolean;
  docType: string | null;
  docTypeLabel: string | null;
}

export interface ResolveContact {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ResolveSubject {
  contact?: ResolveContact | null;
  workspaceName?: string | null;
  /** Lo que resolvieron los módulos registrados (`resolveRegisteredValues`). */
  registered?: Readonly<Record<string, string>>;
  /** El código de la pieza, si ya existe (un reintento); al crear todavía no hay. */
  code?: string | null;
  /** Cuándo se crea (la fecha de emisión). */
  now: Date;
  /** La zona del negocio (`workspaces.timezone`). */
  timeZone: string;
}

export type ValueSource = "override" | "subject" | "default" | "system" | "sample" | "empty";

export interface MissingValue {
  key: string;
  label: string;
}

export interface ResolveResult {
  /** Una entrada por variable resuelta (las usadas, las propias y las de siempre). Sin valor = cadena vacía. */
  values: Record<string, string>;
  /** Las variables que el documento usa y que no tienen valor propio (ni pasado, ni del sujeto, ni por defecto), aunque después la política las rellene. */
  missing: MissingValue[];
  /** `false` solo con la política `fail` y algún dato faltante: la pieza no se genera. */
  ok: boolean;
  /** De dónde salió cada valor (para «Detalle» y para el modal). */
  sources: Record<string, ValueSource>;
}

const present = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** «Falta: A, B» (y «Falta: A, B y C» no: una lista simple, corta y sin conjunciones que cambien). */
export function missingMessage(missing: readonly { label: string }[]): string {
  return `${MISSING_PREFIX}${missing.map((m) => m.label).join(", ")}`;
}

/** Si el motivo guardado de una pieza fallida es de un dato que falta (y no de un render). */
export function isMissingDataError(error: string | null | undefined): boolean {
  return typeof error === "string" && error.startsWith(MISSING_PREFIX);
}

/**
 * El valor de una variable del sistema o del sujeto, o `null` si el sujeto no lo tiene.
 * Nunca devuelve el valor de ejemplo del catálogo: «Ana Pérez» en el certificado de otra persona no sirve a nadie.
 */
function fromSubject(key: string, subject: ResolveSubject, template: ResolveTemplate): string | null {
  switch (key) {
    case "contact.first_name":
      return subject.contact ? firstNameOf(subject.contact.display_name) : null;
    case "contact.display_name":
      return subject.contact?.display_name ?? null;
    case "contact.email":
      return subject.contact?.email ?? null;
    case "contact.phone":
      return subject.contact?.phone ?? null;
    case "workspace.name":
      return subject.workspaceName ?? null;
    case "design.code":
      return subject.code ?? "";
    case "design.doc_type":
      return docTypeVariable({ verify: template.verify, doc_type: template.docType, doc_type_label: template.docTypeLabel });
    case "design.issued_on":
    case "design.today":
      return formatDesignDate(subject.now, template.dateFormat, subject.timeZone);
    default:
      return subject.registered && key in subject.registered ? subject.registered[key] : null;
  }
}

/**
 * Resuelve los valores de una pieza. `overrides` gana sobre el sujeto y el sujeto sobre el valor por defecto. Una cadena
 * vacía o de solo espacios en `overrides` cuenta como «no se pasó».
 */
export function resolveValues(
  template: ResolveTemplate,
  subject: ResolveSubject,
  overrides: Readonly<Record<string, string>> = {},
  policy: MissingPolicy = "fail",
): ResolveResult {
  const custom = new Map(template.customVars.map((v) => [v.key, v]));
  const keys: string[] = [];
  const push = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };
  for (const key of template.docKeys) push(key);
  for (const v of template.customVars) push(v.key);
  for (const key of ALWAYS_RESOLVED_KEYS) push(key);
  for (const key of Object.keys(subject.registered ?? {})) push(key);
  const used = new Set(template.docKeys);

  const values: Record<string, string> = {};
  const sources: Record<string, ValueSource> = {};
  const missing: MissingValue[] = [];

  for (const key of keys) {
    const override = overrides[key];
    if (present(override)) {
      values[key] = override.trim();
      sources[key] = "override";
      continue;
    }
    const own = fromSubject(key, subject, template);
    // El código y los valores del sistema que pueden quedar vacíos (el tipo de una plantilla sin verificación) no son un dato que falte.
    if (SYSTEM_KEYS.has(key)) {
      values[key] = own ?? "";
      sources[key] = "system";
      continue;
    }
    if (present(own)) {
      values[key] = own.trim();
      sources[key] = "subject";
      continue;
    }
    const customVar = custom.get(key);
    if (customVar && present(customVar.default)) {
      values[key] = customVar.default.trim();
      sources[key] = "default";
      continue;
    }
    // Sin valor: una variable que el documento usa es un dato que falta; una que no se usa solo queda vacía.
    values[key] = "";
    sources[key] = "empty";
    if (!used.has(key)) continue;
    missing.push({ key, label: variableInfo(key, { customVars: template.customVars }).label });
    if (policy === "template_default" && customVar && present(customVar.sample)) {
      values[key] = customVar.sample.trim();
      sources[key] = "sample";
    }
  }

  // `fail` frena solo si algo sigue faltando; con las otras dos políticas la pieza se genera igual.
  return { values, missing, ok: policy !== "fail" || missing.length === 0, sources };
}
