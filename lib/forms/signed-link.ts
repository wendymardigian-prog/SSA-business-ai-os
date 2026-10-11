/**
 * El link de un formulario FIRMADO para un contacto (F20, D13). SOLO servidor.
 *
 * `<base>/f/<slug>?c=<token>`, con `token = base64url(JSON) + "." + base64url(HMAC)`.
 * El JSON es `{ v: 1, f: form_id, c: contact_id, s?: service_id, o?: sale_id, e: exp }`.
 *
 * - Los tres ids viajan DENTRO de la firma, nunca sueltos en la URL: alterar uno
 *   rompe el HMAC. Un `service_id`, `sale_id` o `contact_id` que llegue como
 *   parámetro suelto se ignora.
 * - El secreto (`forms_link_secret`) vive en Vault, uno por workspace, y se genera
 *   la primera vez. Sin estado y sin tabla: el token vence solo (60 días).
 * - Un token inválido NO da error: se ignora entero y el envío sigue como si no
 *   hubiera link firmado (así no se revela nada).
 *
 * `signFormLink` es la función que usan Ventas (botón "Enviar contrato", con
 * `saleId`) y CX (ítems del camino, con `serviceId`). `service_id` y `sale_id` se
 * guardan sin validar contra tablas que todavía no existen.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES, storeSecret } from "@/lib/vault";
import { FORM_LIMITS } from "./limits";

type Db = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenPayload {
  v: 1;
  f: string;
  c: string;
  s?: string;
  o?: string;
  e: number;
}

function b64(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export interface TokenInput {
  formId: string;
  contactId: string;
  serviceId?: string | null;
  saleId?: string | null;
  ttlDays?: number;
  now?: number;
}

/** Arma el token (sin la URL). Puro respecto de la base: recibe el secreto. */
export function createToken(input: TokenInput, secret: string): string {
  const now = input.now ?? Date.now();
  const payload: TokenPayload = {
    v: 1,
    f: input.formId,
    c: input.contactId,
    ...(input.serviceId ? { s: input.serviceId } : {}),
    ...(input.saleId ? { o: input.saleId } : {}),
    e: Math.floor((now + (input.ttlDays ?? FORM_LIMITS.signedLinkDays) * DAY_MS) / 1000),
  };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(body, secret))}`;
}

export type TokenReason = "format" | "signature" | "expired" | "form" | "ids";

export type ReadResult = { ok: true; payload: TokenPayload } | { ok: false; reason: TokenReason };

/** Verifica formato, firma (en tiempo constante), vencimiento, formulario e ids. NO mira la base. */
export function readToken(token: string, secret: string, expected: { formId: string; now?: number }): ReadResult {
  if (typeof token !== "string" || token.length > 1000) return { ok: false, reason: "format" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "format" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "format" };
  }
  if (!payload || typeof payload !== "object" || payload.v !== 1) return { ok: false, reason: "format" };

  // La firma se compara ANTES de creer nada de lo que dice el payload.
  const given = Buffer.from(parts[1], "base64url");
  const wanted = mac(parts[0], secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { ok: false, reason: "signature" };

  if (typeof payload.e !== "number" || payload.e * 1000 < (expected.now ?? Date.now())) return { ok: false, reason: "expired" };
  if (payload.f !== expected.formId) return { ok: false, reason: "form" };
  if (typeof payload.c !== "string" || !UUID.test(payload.c)) return { ok: false, reason: "ids" };
  if (payload.s !== undefined && !UUID.test(String(payload.s))) return { ok: false, reason: "ids" };
  if (payload.o !== undefined && !UUID.test(String(payload.o))) return { ok: false, reason: "ids" };

  return { ok: true, payload };
}

/** La clave de firma de este workspace: se genera la primera vez y queda en Vault. */
export async function getOrCreateLinkSecret(service: Db, workspaceId: string): Promise<string> {
  try {
    const existing = await readSecret(service, workspaceId, SECRET_NAMES.formsLinkSecret);
    if (existing) return existing;
  } catch {
    // No estar es el caso normal la primera vez.
  }
  const secret = randomBytes(32).toString("base64url");
  const stored = await storeSecret(service, workspaceId, SECRET_NAMES.formsLinkSecret, secret);
  if (!stored.ok) throw new Error(`No pude guardar la clave de firma de los links: ${stored.error}`);
  return secret;
}

export interface SignInput extends TokenInput {
  workspaceId: string;
  slug: string;
  /** La dirección pública de la app (sin barra final). */
  baseUrl: string;
}

export async function signFormLink(service: Db, input: SignInput): Promise<string> {
  const secret = await getOrCreateLinkSecret(service, input.workspaceId);
  const token = createToken(input, secret);
  return `${input.baseUrl.replace(/\/$/, "")}/f/${input.slug}?c=${token}`;
}

export type VerifyResult =
  | { ok: true; contactId: string; serviceId: string | null; saleId: string | null }
  | { ok: false; reason: TokenReason | "contact" };

/**
 * El orden del plano: formato → firma → vencimiento → formulario → el contacto
 * existe en ESTE workspace y no está borrado → ids con forma de UUID. Si falla
 * cualquiera, el token se ignora entero.
 */
export async function verifyFormLink(
  service: Db,
  token: string | null | undefined,
  context: { workspaceId: string; formId: string; now?: number },
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "format" };
  let secret: string | null = null;
  try {
    secret = await readSecret(service, context.workspaceId, SECRET_NAMES.formsLinkSecret);
  } catch {
    secret = null;
  }
  // Sin secreto nunca se firmó nada en este workspace: ningún token puede ser válido.
  if (!secret) return { ok: false, reason: "signature" };

  const read = readToken(token, secret, { formId: context.formId, now: context.now });
  if (!read.ok) return read;

  const { data: contact } = await service
    .from("contacts")
    .select("id")
    .eq("id", read.payload.c)
    .eq("workspace_id", context.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { ok: false, reason: "contact" };

  return { ok: true, contactId: read.payload.c, serviceId: read.payload.s ?? null, saleId: read.payload.o ?? null };
}
