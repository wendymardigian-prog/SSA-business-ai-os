/**
 * El modal «Generar para varios…» (F51): qué se dice de la audiencia, cuándo se puede confirmar y qué se manda. Puro y con
 * su test; el componente solo lo dibuja.
 *
 * La audiencia son los filtros de Contactos (etiqueta, segmento, búsqueda…) escritos como parámetros de URL; el servidor
 * los resuelve con la sesión de la persona (la RLS decide a quiénes ve) y los fija al confirmar. Máximo 500 por tanda.
 */

import type { GenerateManyInput } from "../contracts";
import { emailProblems } from "../email-text";
import { DOC_TYPE_LABELS, isDocType } from "../verification";

/** Lo mismo que `MAX_GENERATE_MANY` del job (acá no se importa: el job es de servidor). */
export const MAX_PER_BATCH = 500;

/** Un dato propio sin valor por defecto no se puede completar «para varios»: todas saldrían fallidas. */
export function blockersMessage(blockers: readonly string[]): string {
  return `Estos datos de la plantilla no tienen un valor por defecto: ${blockers.join(", ")}. Poné uno en la plantilla, o generá de a una pieza.`;
}

type Params = Record<string, string | string[]>;

/** Los filtros de Contactos como parámetros de URL (`tag=a&tag=b&q=Ana`), sin el «?» y sin vacíos. */
export function paramsToQuery(params: Params): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) if (v.trim() !== "") out.append(key, v);
  }
  return out.toString();
}

/** «Saltear a quienes ya tienen uno válido»: con el tipo de documento ("un certificado válido", "una constancia válida"). */
export function skipLabel(template: { doc_type: string | null; doc_type_label: string | null }): string {
  const type = isDocType(template.doc_type) ? template.doc_type : null;
  if (!type || type === "otro") return "Saltear a quienes ya tienen uno válido";
  const noun = DOC_TYPE_LABELS[type].toLowerCase();
  return `Saltear a quienes ya tienen ${type === "constancia" ? "una" : "un"} ${noun} ${type === "constancia" ? "válida" : "válido"}`;
}

export interface ManyCounts {
  total: number;
  existing: number;
  willGenerate: number;
  over: boolean;
  blockers: readonly string[];
}

/** «23 cumplen · 4 ya tienen uno válido (se saltean)». */
export function countLine(counts: ManyCounts, skipExisting: boolean): string {
  const parts = [counts.total === 1 ? "1 cumple" : `${counts.total} cumplen`];
  if (counts.existing > 0) parts.push(`${counts.existing} ya ${counts.existing === 1 ? "tiene" : "tienen"} uno válido${skipExisting ? (counts.existing === 1 ? " (se saltea)" : " (se saltean)") : " (se reemplaza)"}`);
  return parts.join(" · ");
}

export interface GenerateManyState {
  counts: ManyCounts | null;
  skipExisting: boolean;
  publish: boolean;
  emailOn: boolean;
  email: { subject: string; body: string };
}

/** Por qué todavía no se puede confirmar (vacío = se puede). */
export function manyReason(state: GenerateManyState): string | null {
  const c = state.counts;
  if (!c) return "Contando a quiénes les toca…";
  if (c.blockers.length > 0) return blockersMessage(c.blockers);
  if (c.total === 0) return "No hay contactos con esos filtros.";
  if (c.over) return `Son ${c.total} contactos y el máximo es ${MAX_PER_BATCH} por vez. Sumá un filtro para generar de a tandas.`;
  if (c.willGenerate <= 0) return "Todos ya tienen una pieza válida: no hay nada para generar.";
  if (state.emailOn) return emailProblems(state.email);
  return null;
}

/** El botón principal: «Generar 19». */
export function manyPrimaryLabel(counts: ManyCounts | null, skipExisting: boolean): string {
  if (!counts) return "Generar";
  const n = skipExisting ? counts.willGenerate : counts.total;
  return n > 0 ? `Generar ${n}` : "Generar";
}

export function buildGenerateManyInput(templateId: string, params: Params, state: GenerateManyState): GenerateManyInput {
  return {
    templateId,
    audienceParams: paramsToQuery(params),
    skipExisting: state.skipExisting,
    publish: state.publish,
    email: state.emailOn ? { subject: state.email.subject.trim(), body: state.email.body.trim() } : null,
  };
}
