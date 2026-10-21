/**
 * El link para que quien ACABA de firmar baje su copia en PDF desde la pantalla de éxito ("Descargar contrato").
 * SOLO servidor.
 *
 * El PDF tiene datos personales (nombre, email, IP), así que el link es una credencial chica:
 *  - `token = base64url(JSON) + "." + base64url(HMAC)`, con `{ v: 1, s: submission_id, f: form_id, e: vencimiento }`.
 *  - Lo firma la misma clave de Vault que los links de formularios (`forms_link_secret`, una por workspace).
 *  - Vence a las 24 horas (después, la copia está en el correo). Sirve para UNA respuesta de UN formulario.
 *  - Solo lo recibe el navegador que acaba de enviar: viaja en la respuesta del envío, nunca en un correo ni en la URL
 *    del formulario.
 * Un token alterado, vencido o de otro formulario no da ningún detalle: "el link no sirve".
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COPY_LINK_HOURS = 24;

interface CopyPayload {
  v: 1;
  s: string;
  f: string;
  e: number;
}

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(`contract-copy:${body}`).digest();

export function createCopyToken(input: { submissionId: string; formId: string; now?: number; ttlHours?: number }, secret: string): string {
  const now = input.now ?? Date.now();
  const payload: CopyPayload = { v: 1, s: input.submissionId, f: input.formId, e: Math.floor((now + (input.ttlHours ?? COPY_LINK_HOURS) * 3_600_000) / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

export type CopyTokenResult = { ok: true; submissionId: string } | { ok: false };

/** Verifica forma, firma (en tiempo constante), vencimiento y formulario. No mira la base. */
export function readCopyToken(token: string | null | undefined, secret: string, expected: { formId: string; now?: number }): CopyTokenResult {
  if (typeof token !== "string" || token.length > 600) return { ok: false };
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { ok: false };
  const given = Buffer.from(signature, "base64url");
  const wanted = mac(body, secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { ok: false };
  let payload: CopyPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CopyPayload;
  } catch {
    return { ok: false };
  }
  if (!payload || payload.v !== 1 || typeof payload.e !== "number" || payload.e * 1000 < (expected.now ?? Date.now())) return { ok: false };
  if (payload.f !== expected.formId || typeof payload.s !== "string" || !UUID.test(payload.s)) return { ok: false };
  return { ok: true, submissionId: payload.s };
}

/** La dirección del botón (relativa: el formulario puede estar embebido en otro dominio, pero la API es la de la app). */
export function copyDownloadPath(slug: string, token: string): string {
  return `/api/public/forms/${encodeURIComponent(slug)}/copy?t=${encodeURIComponent(token)}`;
}
