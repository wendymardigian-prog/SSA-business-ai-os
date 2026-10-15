/**
 * El link con seguimiento (Extra I, F40): `<APP_URL>/l/<token>`. SOLO servidor.
 *
 * Un flujo que manda un link con "Registrar el clic" encendido NO manda la URL de destino: manda una ruta corta
 * del sistema que registra el clic y redirige. El destino sale UNICAMENTE del token firmado (no existe un `?to=`),
 * asi que esto no es un open redirect, y el token no se puede reenviar para asignarle una visita a otra persona
 * sin que quede registrada como un clic de la persona original.
 *
 * Token: `base64url(JSON) + "." + base64url(HMAC-SHA256(body, secreto))`, con
 *
 *   { v: 1, w: workspace_id, c: contact_id, u: url_destino, f: flow_id, p: content_post_id | null,
 *     s: social_post_id | null, e: vencimiento (segundos desde epoch) }
 *
 * Vence a los 180 dias. Mismo patron que `lib/forms/signed-link.ts`, con una diferencia a proposito: la firma se
 * compara en tiempo constante ANTES de creer nada del payload, y el destino solo se ofrece para redirigir cuando
 * la firma es valida (ver `verifyTrackedLink`).
 *
 * Este modulo es PURO respecto de la base y de Vault: recibe el secreto por parametro. Leerlo o crearlo (el
 * secreto `attribution_link_secret` de cada workspace) es de quien lo llama. No importa nada de `lib/vault.ts`.
 *
 * `verifyTrackedLink` y `safeRedirectTarget` NUNCA lanzan: una ruta publica no puede dar 500 por un token raro.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cuanto dura un link con seguimiento. */
export const TRACKED_LINK_TTL_DAYS = 180;
/** Largo maximo de la URL de destino dentro del token (mismo tope que `entry_url`). */
export const MAX_DESTINATION_LENGTH = 2000;
/** Largo maximo de un token que se acepta leer. */
export const MAX_TOKEN_LENGTH = 4096;

export interface TrackedLinkPayload {
  v: 1;
  /** workspace_id */
  w: string;
  /** contact_id */
  c: string;
  /** url de destino (ya con los UTM) */
  u: string;
  /** flow_id */
  f: string;
  /** content_post_id */
  p: string | null;
  /** social_post_id */
  s: string | null;
  /** vencimiento, en segundos desde epoch */
  e: number;
}

/** Lo que se firma: el payload sin `v` (siempre 1) y con `e` opcional (por defecto, 180 dias desde `now`). */
export interface TrackedLinkInput {
  w: string;
  c: string;
  u: string;
  f: string;
  p?: string | null;
  s?: string | null;
  e?: number;
}

const b64 = (data: Buffer | string): string => Buffer.from(data).toString("base64url");
const mac = (body: string, secret: string): Buffer => createHmac("sha256", secret).update(body).digest();

/** ¿Es una URL absoluta http(s)? (Sin esquemas raros: `javascript:`, `data:`, `file:`…) */
function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Firma un link con seguimiento. Lanza si el pedido no es valido (secreto vacio, ids que no son UUID, destino
 * que no es http(s) o demasiado largo): es un error de programacion, no un dato de afuera, y quien manda el
 * mensaje lo envuelve en un `try/catch` para mandar la URL con UTM sin seguimiento.
 */
export function signTrackedLink(input: TrackedLinkInput, secret: string, now: number = Date.now()): string {
  if (typeof secret !== "string" || secret === "") throw new Error("Falta el secreto para firmar el link");
  if (!UUID.test(input.w) || !UUID.test(input.c) || !UUID.test(input.f)) throw new Error("Los ids del link no son validos");
  if (input.p != null && !UUID.test(input.p)) throw new Error("La pieza del link no es valida");
  if (input.s != null && !UUID.test(input.s)) throw new Error("La publicacion del link no es valida");
  if (!isHttpUrl(input.u) || input.u.length > MAX_DESTINATION_LENGTH) throw new Error("El destino del link tiene que ser http(s) y de hasta 2000 caracteres");

  const payload: TrackedLinkPayload = {
    v: 1,
    w: input.w,
    c: input.c,
    u: input.u,
    f: input.f,
    p: input.p ?? null,
    s: input.s ?? null,
    e: input.e ?? Math.floor((now + TRACKED_LINK_TTL_DAYS * DAY_MS) / 1000),
  };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(body, secret))}`;
}

export type TrackedLinkReason = "format" | "signature" | "expired" | "payload";

export type VerifyTrackedLinkResult =
  | { ok: true; payload: TrackedLinkPayload }
  | {
      ok: false;
      reason: TrackedLinkReason;
      /**
       * A donde redirigir igual. SOLO cuando la firma es valida (token vencido o con un payload que no sirve para
       * registrar pero con destino http(s)): un destino leido de un token cuya firma NO coincide es texto que
       * puso cualquiera, y redirigir a el seria un open redirect. Con una firma invalida no hay `destination`.
       */
      destination?: string;
    };

function decodeBody(body: string): unknown {
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * El workspace que dice un token, SIN verificar nada. Sirve solo para saber de que workspace leer el secreto con
 * el que despues se verifica de verdad. Null si no se puede leer o no es un UUID. No confiar en este valor para
 * nada mas.
 */
export function peekTrackedLinkWorkspace(token: unknown): string | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const payload = decodeBody(parts[0]);
  if (!payload || typeof payload !== "object") return null;
  const w = (payload as { w?: unknown }).w;
  return typeof w === "string" && UUID.test(w) ? w : null;
}

/**
 * Verifica formato, firma (en tiempo constante), vencimiento y forma del payload. NO mira la base ni a quien lo
 * abre. Nunca lanza.
 */
export function verifyTrackedLink(token: unknown, secret: string | null | undefined, now: number = Date.now()): VerifyTrackedLinkResult {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "format" };
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "format" };

    const raw = decodeBody(parts[0]);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "format" };
    if ((raw as { v?: unknown }).v !== 1) return { ok: false, reason: "format" };

    // Sin secreto no hay forma de comprobar nada: nunca se firmo un link en este workspace.
    if (typeof secret !== "string" || secret === "") return { ok: false, reason: "signature" };

    // La firma se compara ANTES de creer nada de lo que dice el payload.
    const given = Buffer.from(parts[1], "base64url");
    const wanted = mac(parts[0], secret);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { ok: false, reason: "signature" };

    // Desde aca el payload es autentico (lo firmamos nosotros).
    const p = raw as Partial<Record<keyof TrackedLinkPayload, unknown>>;
    const destination = isHttpUrl(p.u) && p.u.length <= MAX_DESTINATION_LENGTH ? p.u : undefined;

    if (typeof p.e !== "number" || !Number.isFinite(p.e)) return { ok: false, reason: "payload", destination };
    if (p.e * 1000 < now) return { ok: false, reason: "expired", destination };

    const optionalUuid = (v: unknown) => v === null || v === undefined || (typeof v === "string" && UUID.test(v));
    if (
      typeof p.w !== "string" || !UUID.test(p.w) ||
      typeof p.c !== "string" || !UUID.test(p.c) ||
      typeof p.f !== "string" || !UUID.test(p.f) ||
      !optionalUuid(p.p) || !optionalUuid(p.s) ||
      !destination
    ) {
      return { ok: false, reason: "payload", destination };
    }

    return {
      ok: true,
      payload: { v: 1, w: p.w, c: p.c, u: destination, f: p.f, p: (p.p as string | null | undefined) ?? null, s: (p.s as string | null | undefined) ?? null, e: p.e },
    };
  } catch {
    return { ok: false, reason: "format" };
  }
}

/**
 * Un destino seguro para un `Location`: solo http(s), sin credenciales en la URL ni caracteres de control; devuelve
 * la URL normalizada. Cualquier otra cosa devuelve `fallback` (la URL de la app, que pone quien llama).
 */
export function safeRedirectTarget(candidate: unknown, fallback: string): string {
  try {
    if (typeof candidate !== "string" || candidate.trim() === "") return fallback;
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
    const url = new URL(candidate.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    if (url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}
