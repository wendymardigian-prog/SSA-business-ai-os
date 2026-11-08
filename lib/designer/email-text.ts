/**
 * El texto del email de una generación (F50, F51, F54): lo que se propone, cómo se pegan las variables y qué se valida.
 * Puro y sin nada de servidor: lo usan los modales del navegador y el envío (`generation-email.ts`).
 */

import { dropDanglingComma } from "@/lib/email/html";

export const MAX_EMAIL_SUBJECT = 200;
export const MAX_EMAIL_BODY = 5000;

export interface EmailRequest {
  subject: string;
  body: string;
}

const VARIABLE = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*(?:\|([^{}]*))?\}\}/g;

/**
 * Pega los valores en un texto. `{{clave}}` sin valor queda vacío; `{{clave|respaldo}}` usa el respaldo. «Hola,
 * {{contact.first_name|}}.» sin nombre queda «Hola.», no «Hola, .» (la misma regla que los demás emails).
 */
export function interpolateGenerationEmail(text: string, values: Readonly<Record<string, string>>): string {
  const rendered = text.replace(VARIABLE, (_m, key: string, fallback: string | undefined) => {
    const value = values[key];
    return typeof value === "string" && value.trim() !== "" ? value : (fallback ?? "").trim();
  });
  return dropDanglingComma(text, rendered);
}

/** El email que se propone al emitir: corto y con el link. `noun` es «certificado», «constancia»… o null («pieza»). */
export function defaultGenerationEmail(noun: string | null): EmailRequest {
  const what = noun ? noun.toLowerCase() : "pieza";
  return {
    subject: `Tu ${what}`,
    body: `Hola {{contact.first_name|}},\n\nAcá está tu ${what}: {{design.link}}\n\nUn saludo.`,
  };
}

/** Lo que pidió la persona al emitir, leído de `source_ref`. Algo que no tiene la forma esperada es «sin email». */
export function parseEmailRequest(sourceRef: unknown): EmailRequest | null {
  if (!sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return null;
  const req = (sourceRef as { email_request?: unknown }).email_request;
  if (!req || typeof req !== "object" || Array.isArray(req)) return null;
  const { subject, body } = req as { subject?: unknown; body?: unknown };
  return typeof subject === "string" && typeof body === "string" && subject.trim() && body.trim() ? { subject, body } : null;
}

/** Los problemas de un asunto y un cuerpo escritos a mano (vacío = se puede mandar). */
export function emailProblems(email: { subject: string; body: string }): string | null {
  const subject = email.subject.trim();
  const body = email.body.trim();
  if (!subject) return "Escribí el asunto del email.";
  if (!body) return "Escribí el mensaje del email.";
  if (subject.length > MAX_EMAIL_SUBJECT) return `El asunto es demasiado largo (hasta ${MAX_EMAIL_SUBJECT} caracteres).`;
  if (body.length > MAX_EMAIL_BODY) return `El mensaje es demasiado largo (hasta ${MAX_EMAIL_BODY} caracteres).`;
  return null;
}
