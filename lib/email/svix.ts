/**
 * La firma de los webhooks de Resend (F63).
 *
 * Resend firma con Svix, que tiene tres cosas propias:
 *
 * 1. **Lo que se firma es `id.timestamp.body`**, no el body solo. Firmar
 *    solo el cuerpo dejaria que alguien reenvie un webhook viejo tal cual.
 * 2. **Pueden venir VARIAS firmas** en la misma cabecera, separadas por
 *    espacio, cada una con su version (`v1,<base64>`). Es como Svix rota
 *    secretos sin cortar la entrega: durante la rotacion manda las dos.
 * 3. **El secreto viene con el prefijo `whsec_`** y el resto es base64. Lo
 *    que se usa para firmar son esos bytes, no el texto.
 *
 * La tolerancia de 5 minutos es contra el reenvio: un webhook capturado hoy
 * no sirve mañana.
 *
 * Modulo puro: no sabe de Supabase ni de Next.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Cuanto puede desviarse el reloj antes de rechazar. */
export const TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "too_old" | "bad_signature" };

/** Los bytes del secreto: `whsec_` fuera, el resto es base64. */
export function secretBytes(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(raw, "base64");
}

/** La firma esperada para ese id, ese momento y ese cuerpo. */
export function expectedSignature(params: {
  secret: string;
  id: string;
  timestamp: string;
  body: string;
}): string {
  return createHmac("sha256", secretBytes(params.secret))
    .update(`${params.id}.${params.timestamp}.${params.body}`)
    .digest("base64");
}

/** Compara en tiempo constante, sin filtrar en cuantos caracteres difiere. */
function equals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function verifySvixSignature(params: {
  secret: string;
  headers: SvixHeaders;
  body: string;
  now?: Date;
}): VerifyResult {
  const { id, timestamp, signature } = params.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "bad_timestamp" };

  const now = (params.now ?? new Date()).getTime();
  // En los dos sentidos: un timestamp del futuro tambien es sospechoso.
  if (Math.abs(now - sentAt) > TOLERANCE_MS) return { ok: false, reason: "too_old" };

  const expected = expectedSignature({ secret: params.secret, id, timestamp, body: params.body });

  // Varias firmas: durante una rotacion de secreto, Svix manda las dos.
  const candidates = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  if (candidates.length === 0) return { ok: false, reason: "bad_signature" };
  if (!candidates.some((candidate) => equals(candidate, expected))) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}

/** El motivo del rechazo, para el log. Nunca va en la respuesta. */
export const REJECTION_REASONS: Record<Exclude<VerifyResult, { ok: true }>["reason"], string> = {
  missing_headers: "faltan las cabeceras de Svix",
  bad_timestamp: "el timestamp no es un numero",
  too_old: "el webhook es de hace mas de 5 minutos",
  bad_signature: "la firma no coincide",
};
