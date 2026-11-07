/**
 * Las propuestas de la IA con «Hacerlo / No» (F30 y F47).
 *
 *   - `template_texts`: «Que la IA me proponga dónde van los textos y las
 *     variables» sobre una imagen base. Guarda el parche; si la persona acepta,
 *     se aplica.
 *   - `enable_verification`: si el pedido o la imagen es un certificado, una
 *     constancia o un diploma y la plantilla es de formato IMPRESO y todavía no
 *     verifica, la IA propone prender la verificación con ese tipo.
 *
 * Módulo puro. Decide qué proponer; guardar y aplicar lo hacen las acciones.
 */

import { isPrintFormat, type FormatKey } from "../formats";
import { verifyProposalText, type DocType } from "../verification";
import type { DocumentKind } from "./schema";

/** Los tipos que la IA puede reconocer (no «otro»: con «otro» hay que escribir un nombre). */
export type RecognizedDocType = Exclude<DocType, "otro">;

const KEYWORDS: { type: RecognizedDocType; re: RegExp }[] = [
  { type: "diploma", re: /\bdiploma/i },
  { type: "constancia", re: /\bconstancia/i },
  { type: "certificado", re: /\bcertificad[oa]/i },
];

/**
 * El tipo de documento que se reconoce: lo que dijo la IA y, si no dijo nada
 * claro, las palabras del pedido. `null` si no es ninguno de los tres.
 */
export function detectDocType(aiKind: DocumentKind | undefined | null, request: string): RecognizedDocType | null {
  if (aiKind === "certificado" || aiKind === "constancia" || aiKind === "diploma") return aiKind;
  if (aiKind === "ninguno" || aiKind === "otro") return null;
  for (const { type, re } of KEYWORDS) if (re.test(request)) return type;
  return null;
}

export interface VerificationProposal {
  kind: "enable_verification";
  status: "pending";
  payload: { doc_type: RecognizedDocType };
  text: string;
}

/** La propuesta de prender la verificación, o `null` si no corresponde. Solo plantillas impresas que todavía no verifican. */
export function verificationProposal(input: { isTemplate: boolean; format: FormatKey; alreadyVerifies: boolean; docType: RecognizedDocType | null }): VerificationProposal | null {
  if (!input.isTemplate || input.alreadyVerifies || !input.docType || !isPrintFormat(input.format)) return null;
  return { kind: "enable_verification", status: "pending", payload: { doc_type: input.docType }, text: verifyProposalText(input.docType) };
}

/** El texto del mensaje de la propuesta de textos para una imagen base. */
export const TEXTS_PROPOSAL_QUESTION = "¿Lo hago?";

export function textsProposalContent(message: string): string {
  const base = message.trim();
  return /¿lo hago\?/i.test(base) ? base : `${base}\n\n${TEXTS_PROPOSAL_QUESTION}`;
}
