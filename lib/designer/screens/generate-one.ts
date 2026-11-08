/**
 * El modal «Emitir <tipo>» / «Generar para…» (F50): qué variables se muestran, qué falta antes de confirmar, la vista previa
 * con los datos reales y lo que se manda. Puro y con su test; el componente solo lo dibuja.
 *
 * Los textos del título, el botón y el aviso «Ya tiene un/a <tipo> válido/a…» salen de `verification.ts` (el tipo de
 * documento de la plantilla), nunca de «certificado» escrito a mano.
 */

import type { DesignDoc } from "../doc/schema";
import type { UploadedFont } from "../fonts";
import type { GenerateOneInput } from "../contracts";
import { defaultGenerationEmail, emailProblems } from "../email-text";
import { renderPageHTML } from "../render/page-html";
import { sampleValues, variableInfo, type CustomVar } from "../variables/catalog";
import { alreadyValidNotice } from "../verification";

export type RowKind = "own" | "system" | "code";

export interface VariableRowView {
  key: string;
  label: string;
  kind: RowKind;
  /** El valor que se ve: lo puesto a mano, si no el de la vista previa del servidor. */
  value: string;
  /** Una propia sin valor por defecto, o un dato del sistema que falta: hay que completarlo antes de confirmar. */
  required: boolean;
  /** Sin valor ahora mismo. */
  empty: boolean;
  /** Se puede escribir (las propias siempre; las del sistema con «Cambiar solo para esta pieza»). */
  editable: boolean;
}

export const CODE_PLACEHOLDER = "Se asigna al emitir";

/**
 * Las variables que usa la plantilla, con su valor y si hace falta completarlas. Las propias primero (son las que se
 * completan), después las del sistema, y el código al final (nunca se escribe: lo asigna el sistema).
 */
export function variableRows(input: {
  usedKeys: readonly string[];
  customVars: readonly CustomVar[];
  /** Los valores de la vista previa del servidor (con lo puesto a mano ya aplicado). */
  values: Readonly<Record<string, string>>;
  /** Las claves que el servidor dijo que faltan. */
  missingKeys: readonly string[];
  overrides: Readonly<Record<string, string>>;
}): VariableRowView[] {
  const own = new Map(input.customVars.map((v) => [v.key, v]));
  const missing = new Set(input.missingKeys);
  const rows: VariableRowView[] = input.usedKeys.map((key) => {
    const info = variableInfo(key, { customVars: input.customVars });
    const typed = input.overrides[key]?.trim() ?? "";
    const kind: RowKind = key === "design.code" ? "code" : own.has(key) ? "own" : "system";
    if (kind === "code") return { key, label: info.label, kind, value: CODE_PLACEHOLDER, required: false, empty: false, editable: false };
    const value = typed || input.values[key]?.trim() || "";
    const customVar = own.get(key);
    const required = kind === "own" ? !(typeof customVar?.default === "string" && customVar.default.trim() !== "") : missing.has(key);
    return { key, label: info.label, kind, value, required, empty: value === "", editable: true };
  });
  const order: Record<RowKind, number> = { own: 0, system: 1, code: 2 };
  return rows.map((row, i) => ({ row, i })).sort((a, b) => order[a.row.kind] - order[b.row.kind] || a.i - b.i).map((x) => x.row);
}

/** Lo que falta completar antes de confirmar: las variables obligatorias sin valor (con su nombre en español). */
export function missingRows(rows: readonly VariableRowView[]): VariableRowView[] {
  return rows.filter((r) => r.required && r.empty);
}

/**
 * Los valores con los que se dibuja la vista previa: los reales; lo que falta se ve como «‹Nombre›» (para que se vea
 * dónde va) y el código, con un ejemplo (el real lo asigna el sistema al emitir).
 */
export function previewValues(rows: readonly VariableRowView[], values: Readonly<Record<string, string>>, overrides: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const [k, v] of Object.entries(overrides)) if (v.trim()) out[k] = v.trim();
  for (const row of rows) {
    if (row.kind === "code") out[row.key] = sampleValues()["design.code"];
    else if (row.empty) out[row.key] = `‹${row.label}›`;
  }
  return out;
}

/** El HTML de la página 1 con los valores reales: el MISMO `renderPageHTML` que el link público y el PDF (modo `public`). */
export function previewHtml(doc: DesignDoc, values: Record<string, string>, assetUrls: Readonly<Record<string, string>>, uploadedFonts: readonly UploadedFont[]): string {
  return renderPageHTML(doc, 0, { mode: "public", values, assetUrl: (path) => assetUrls[path] ?? "", uploadedFonts });
}

export interface GenerateOneState {
  contactId: string | null;
  rows: readonly VariableRowView[];
  publish: boolean;
  emailOn: boolean;
  email: { subject: string; body: string };
  /** Si el contacto elegido tiene email (null = todavía no se sabe). */
  contactHasEmail: boolean | null;
  existing: { code: string } | null;
  replace: boolean;
}

/** Por qué todavía no se puede confirmar (vacío = se puede). El primero que aparece es el que se muestra. */
export function submitReason(state: GenerateOneState, template: { doc_type: string | null; doc_type_label: string | null }): string | null {
  if (!state.contactId) return "Elegí para quién es la pieza.";
  const missing = missingRows(state.rows);
  if (missing.length > 0) return `Completá: ${missing.map((m) => m.label).join(", ")}.`;
  if (state.existing && !state.replace) return alreadyValidNotice(template, state.existing.code);
  if (state.emailOn) {
    if (state.contactHasEmail === false) return "Este contacto no tiene email.";
    const problem = emailProblems(state.email);
    if (problem) return problem;
  }
  return null;
}

/** El email que se propone al prender «Mandar por email» (con el link de la pieza). */
export function initialEmail(noun: string | null): { subject: string; body: string } {
  return defaultGenerationEmail(noun);
}

/** Lo que se manda a `generateOne`: solo lo que la persona puso a mano. */
export function buildGenerateOneInput(templateId: string, state: GenerateOneState, overrides: Readonly<Record<string, string>>): GenerateOneInput {
  const typed = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim() !== ""));
  return {
    templateId,
    contactId: state.contactId,
    overrides: typed,
    publish: state.publish,
    email: state.emailOn ? { subject: state.email.subject.trim(), body: state.email.body.trim() } : null,
    ...(state.existing && state.replace ? { replaceExisting: true } : {}),
  };
}

/** El texto del botón mientras se genera. */
export function busyLabel(issueLabel: string): string {
  return issueLabel.startsWith("Emitir") ? "Emitiendo…" : "Generando…";
}
