/**
 * La verificación de las plantillas (F47, cambios 1.2 del plano).
 *
 * - Solo existe en plantillas de formato IMPRESO (carta y A4). Nunca en diseños
 *   sueltos, redes, presentaciones ni páginas web: ahí el interruptor no aparece.
 * - Arranca apagada. Al prenderla se elige el tipo de documento: Certificado,
 *   Constancia, Diploma u Otro (con "Otro" se escribe el nombre, hasta 40).
 * - El texto del recuadro del link, los botones y los avisos salen del tipo.
 *
 * `validateTemplateVerification` es la gemela de los CHECK de
 * `design_templates` (D2): los casos de `verification.cases.json` corren
 * contra las dos (vitest y `verify-designer --bloque ds0`).
 *
 * Módulo puro.
 */

import { isPrintFormat, PRINT_FORMATS, type FormatKey } from "./formats";

export { PRINT_FORMATS };

export const DOC_TYPES = ["certificado", "constancia", "diploma", "otro"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  certificado: "Certificado",
  constancia: "Constancia",
  diploma: "Diploma",
  otro: "Otro",
};

export const MAX_DOC_TYPE_LABEL = 40;

/** El rótulo del interruptor en Configuración (F28). */
export const VERIFY_TOGGLE_LABEL = "Se puede verificar";
/** El aviso cuando un cambio de formato apaga la verificación. */
export const FORMAT_NOT_VERIFIABLE = "Este formato no admite verificación";

export type VerificationStatus = "valid" | "void";

export function isDocType(value: unknown): value is DocType {
  return typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value);
}

/** Si una plantilla de ese formato puede llevar verificación. */
export function canVerify(format: FormatKey): boolean {
  return isPrintFormat(format);
}

export interface TemplateVerification {
  format: FormatKey | string;
  verify: boolean;
  doc_type: string | null;
  doc_type_label: string | null;
}

/**
 * Los problemas de la configuración de verificación de una plantilla, en
 * español. Vacío = se puede guardar. Es la misma regla que los CHECK de D2.
 */
export function validateTemplateVerification(t: TemplateVerification): string[] {
  const problems: string[] = [];
  const label = t.doc_type_label;
  if (t.doc_type !== null && !isDocType(t.doc_type)) problems.push("El tipo de documento no es uno de los cuatro.");
  if (label !== null) {
    const trimmed = label.trim();
    if (t.doc_type !== "otro") problems.push("El nombre del documento solo se escribe con «Otro».");
    else if (trimmed.length < 1 || trimmed.length > MAX_DOC_TYPE_LABEL) problems.push(`Escribí el nombre del documento (hasta ${MAX_DOC_TYPE_LABEL} caracteres).`);
  }
  if (t.verify) {
    if (!(PRINT_FORMATS as readonly string[]).includes(t.format)) problems.push(`${FORMAT_NOT_VERIFIABLE}.`);
    if (t.doc_type === null) problems.push("Elegí el tipo de documento.");
    else if (t.doc_type === "otro" && (label === null || label.trim().length === 0)) problems.push(`Escribí el nombre del documento (hasta ${MAX_DOC_TYPE_LABEL} caracteres).`);
  }
  return [...new Set(problems)];
}

/**
 * Qué pasa con la verificación al cambiar el formato de una plantilla: si el
 * formato nuevo no la admite, se apaga sola y se avisa.
 */
export function verifyAfterFormatChange(current: { verify: boolean }, newFormat: FormatKey): { verify: boolean; notice: string | null } {
  if (current.verify && !canVerify(newFormat)) return { verify: false, notice: FORMAT_NOT_VERIFIABLE };
  return { verify: current.verify, notice: null };
}

/** El nombre del tipo, como se escribe en una oración ("Certificado", "Constancia", o el de "Otro"). */
export function docTypeNoun(type: DocType | null | undefined, label?: string | null): string {
  if (type === "otro") return label?.trim() || "Documento";
  if (type && isDocType(type)) return DOC_TYPE_LABELS[type];
  return "Documento";
}

/** Si el sustantivo es femenino (para "válida" / "anulada"). "Otro" no tiene género conocido. */
function feminine(type: DocType | null | undefined): boolean {
  return type === "constancia";
}

/**
 * El texto del recuadro de verificación del link público (F43/F47).
 * - Certificado: "✅ Certificado válido · emitido por <negocio> el <fecha> · Código <código>" / "⛔ Certificado anulado · Motivo: …".
 * - Constancia: "✅ Constancia válida · emitida por …" / "⛔ Constancia anulada · Motivo: …".
 * - Diploma: "✅ Diploma válido · emitido por …" / "⛔ Diploma anulado · Motivo: …".
 * - Otro: "✅ Verificado · <nombre> emitido por <negocio> el <fecha> · Código <código>" / "⛔ Anulado · <nombre> · Motivo: …".
 */
export function verificationText(
  docType: DocType | null | undefined,
  label: string | null | undefined,
  status: VerificationStatus,
  business: string,
  date: string,
  code: string,
  reason?: string | null,
): string {
  const motivo = reason?.trim() || "sin motivo";
  if (docType === "otro" || !docType) {
    const name = docTypeNoun("otro", label);
    return status === "valid" ? `✅ Verificado · ${name} emitido por ${business} el ${date} · Código ${code}` : `⛔ Anulado · ${name} · Motivo: ${motivo}`;
  }
  const noun = DOC_TYPE_LABELS[docType];
  const f = feminine(docType);
  return status === "valid"
    ? `✅ ${noun} ${f ? "válida" : "válido"} · ${f ? "emitida" : "emitido"} por ${business} el ${date} · Código ${code}`
    : `⛔ ${noun} ${f ? "anulada" : "anulado"} · Motivo: ${motivo}`;
}

/** El título corto del recuadro ("Certificado válido", "Constancia anulada", "Verificado", "Anulado"). */
export function verificationTitle(docType: DocType | null | undefined, status: VerificationStatus): string {
  if (docType === "otro" || !docType) return status === "valid" ? "Verificado" : "Anulado";
  const f = feminine(docType);
  return `${DOC_TYPE_LABELS[docType]} ${status === "valid" ? (f ? "válida" : "válido") : f ? "anulada" : "anulado"}`;
}

/** El botón principal de una plantilla: "Emitir constancia" si verifica; si no, "Generar para…". */
export function issueButtonLabel(template: { verify: boolean; doc_type: DocType | string | null; doc_type_label: string | null }): string {
  if (!template.verify || !isDocType(template.doc_type)) return "Generar para…";
  return `Emitir ${docTypeNoun(template.doc_type, template.doc_type_label).toLowerCase()}`;
}

/** El aviso cuando la persona ya tiene una pieza válida de la plantilla (F50). */
export function alreadyValidNotice(template: { doc_type: DocType | string | null; doc_type_label: string | null }, code: string): string {
  const type = isDocType(template.doc_type) ? template.doc_type : null;
  if (type === "otro" || !type) return `Ya tiene uno válido (${docTypeNoun("otro", template.doc_type_label)}, código ${code}): ¿reemplazarlo?`;
  const f = feminine(type);
  return `Ya tiene ${f ? "una" : "un"} ${DOC_TYPE_LABELS[type].toLowerCase()} ${f ? "válida" : "válido"} (código ${code}): ¿${f ? "reemplazarla" : "reemplazarlo"}?`;
}

/** La propuesta de la IA para prender la verificación (F47, "Con IA"). */
export function verifyProposalText(type: Exclude<DocType, "otro">): string {
  return `Parece ${type === "constancia" ? "una constancia" : `un ${DOC_TYPE_LABELS[type].toLowerCase()}`}. ¿Prendo la verificación como ${DOC_TYPE_LABELS[type]}? Así cada pieza emitida lleva su código y se puede comprobar con el link.`;
}

/** El valor de la variable `design.doc_type` (el nombre del tipo; vacío si la plantilla no verifica). */
export function docTypeVariable(template: { verify: boolean; doc_type: DocType | string | null; doc_type_label: string | null }): string {
  if (!template.verify || !isDocType(template.doc_type)) return "";
  return docTypeNoun(template.doc_type, template.doc_type_label);
}
