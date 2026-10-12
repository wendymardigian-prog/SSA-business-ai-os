/**
 * La configuración de un contrato (F24). PURO.
 *
 * El texto NO vive acá: está en `draft_definition.contractText` y se congela en
 * `form_versions.contract_text` al publicar (así la huella es sobre un texto que
 * no cambia).
 */
import { z } from "zod";
import { DEFAULT_ACCEPT_LABEL, type ContractConfig } from "@/lib/forms/defaults";
import type { FormField } from "@/lib/forms/fields";

export { DEFAULT_ACCEPT_LABEL };
export type { ContractConfig };

export const MAX_CC_EMAILS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const schema = z.object({
  title: z.string().trim().min(1, "Poné un título para el contrato").max(120),
  signatureRequired: z.boolean(),
  acceptLabel: z.string().trim().min(1).max(200),
  ccEmails: z.array(z.string().trim().toLowerCase().regex(EMAIL_RE, "Una de las direcciones de copia no es válida")).max(MAX_CC_EMAILS, `Hasta ${MAX_CC_EMAILS} direcciones de copia`),
});

export type ContractConfigResult = { ok: true; config: ContractConfig } | { ok: false; errors: string[] };

export function validateContractConfig(input: unknown): ContractConfigResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: [...new Set(parsed.error.issues.map((i) => i.message))] };
  return { ok: true, config: { ...parsed.data, ccEmails: [...new Set(parsed.data.ccEmails)] } };
}

/** La configuración guardada con valores por defecto si falta algo (nunca lanza). */
export function parseStoredContractConfig(raw: unknown, fallbackTitle = "Contrato"): ContractConfig {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<ContractConfig>;
  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 120) : fallbackTitle,
    signatureRequired: typeof obj.signatureRequired === "boolean" ? obj.signatureRequired : true,
    acceptLabel: typeof obj.acceptLabel === "string" && obj.acceptLabel.trim() ? obj.acceptLabel.trim().slice(0, 200) : DEFAULT_ACCEPT_LABEL,
    ccEmails: Array.isArray(obj.ccEmails) ? obj.ccEmails.filter((e): e is string => typeof e === "string" && EMAIL_RE.test(e)).slice(0, MAX_CC_EMAILS) : [],
  };
}

/** Las direcciones de copia en una línea ("a@x.com, b@y.com") → lista limpia. */
export function parseCcInput(text: string): string[] {
  return [...new Set(text.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** El campo donde el firmante escribe su email: el primer email obligatorio. */
export function signerEmailField(fields: FormField[]): FormField | undefined {
  return fields.find((f) => f.type === "email" && f.required);
}

/**
 * El nombre del firmante: el primer campo de texto corto cuya clave o etiqueta lo
 * diga (nombre, firmante, name) o, si no hay, el primer texto corto con valor.
 */
export function signerNameFromAnswers(fields: FormField[], values: Record<string, unknown>): string {
  const field = signerNameField(fields, values);
  return field ? (values[field.key] as string).trim() : "";
}

/** El campo de donde sale el nombre del firmante (el que `signerNameFromAnswers` lee), o undefined si ninguno tiene valor. */
export function signerNameField(fields: FormField[], values: Record<string, unknown>): FormField | undefined {
  const text = (key: string) => (typeof values[key] === "string" ? (values[key] as string).trim() : "");
  const named = fields.find((f) => f.type === "short_text" && /nombre|name|firmante|signer/i.test(`${f.key} ${f.label}`) && text(f.key));
  return named ?? fields.find((f) => f.type === "short_text" && text(f.key));
}

/**
 * Las respuestas que van en la lista del PDF: todas MENOS los dos campos de los que salen el nombre y el email del
 * firmante, que el PDF ya muestra en "Firmante" (si no, aparecían dos veces). Respeta el orden de la versión.
 */
export function pdfSkippedKeys(fields: FormField[], values: Record<string, unknown>): Set<string> {
  const skip = new Set<string>();
  const email = signerEmailField(fields);
  const name = signerNameField(fields, values);
  if (email) skip.add(email.key);
  if (name) skip.add(name.key);
  return skip;
}
