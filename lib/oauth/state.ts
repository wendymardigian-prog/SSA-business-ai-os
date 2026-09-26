/**
 * El `state` del flujo de OAuth: un token firmado, sin tabla (F9).
 *
 * El `state` es el parametro que se manda al proveedor y vuelve con el codigo.
 * Existe para una sola cosa: que el retorno que estamos atendiendo sea el del
 * pedido que hicimos nosotros, y no uno que alguien preparo para conectar SU
 * cuenta en NUESTRO workspace.
 *
 * Se resuelve con un token firmado en vez de una tabla `oauth_states`: no hay
 * fila que crear, ni cron que purgue lo que quedo a medias, y el token se
 * valida sin consultar nada.
 *
 * Tres cosas lo protegen, y hacen falta las tres:
 *   1. **La firma** (HMAC-SHA256 con un secreto del workspace que vive en
 *      Vault): nadie puede fabricar un `state` valido.
 *   2. **El vencimiento** (10 minutos): un token robado no sirve mañana.
 *   3. **El nonce contra una cookie httpOnly**: la firma sola no alcanza,
 *      porque un token valido sigue siendo valido si alguien lo copia. La
 *      cookie la puso este navegador y el atacante no la tiene.
 *
 * El modulo es puro: recibe el secreto y devuelve texto. Quien lo lee de Vault
 * y quien pone la cookie es `flow.ts`.
 */

import { createHmac, randomBytes } from "node:crypto";
import { constantTimeEquals } from "@/lib/crypto";

/** Cuanto vale un `state`. Diez minutos alcanzan de sobra para autorizar. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  /** Lo que ata el token a este navegador, via cookie. */
  nonce: string;
  provider: string;
  /** Quien inicio la conexion. */
  userId: string;
  workspaceId: string;
  /** A donde volver despues, siempre una ruta interna. */
  redirectTo: string;
  /** Vencimiento, en milisegundos epoch. */
  exp: number;
}

export type StateFailure =
  | "invalid_format"
  | "bad_signature"
  | "expired"
  | "user_mismatch"
  | "workspace_mismatch"
  | "nonce_mismatch"
  | "provider_mismatch";

export type StateResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: StateFailure };

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Un nonce nuevo. Va en el token y en la cookie. */
export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Arma el `state`: `<cuerpo>.<firma>`.
 *
 * El cuerpo viaja legible (base64url de un JSON) a proposito: no hay nada
 * secreto adentro, y poder leerlo hace que un problema se diagnostique mirando
 * la URL en vez de adivinando.
 */
export function signState(secret: string, payload: StatePayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(secret, body)}`;
}

export interface VerifyOptions {
  /** Quien esta atendiendo el retorno: tiene que ser quien lo inicio. */
  expectedUserId?: string;
  expectedWorkspaceId?: string;
  expectedProvider?: string;
  /** El nonce de la cookie. Sin el, un token copiado alcanzaria. */
  expectedNonce?: string | null;
  now?: number;
}

export function verifyState(
  secret: string,
  token: string | null | undefined,
  options: VerifyOptions = {},
): StateResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "invalid_format" };

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "invalid_format" };

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  // La firma se verifica ANTES de mirar el contenido: lo que viene de afuera
  // no se interpreta hasta saber que lo escribimos nosotros.
  if (!constantTimeEquals(signature, sign(secret, body))) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_format" };
  }

  if (
    typeof payload?.nonce !== "string" ||
    typeof payload?.provider !== "string" ||
    typeof payload?.userId !== "string" ||
    typeof payload?.workspaceId !== "string" ||
    typeof payload?.redirectTo !== "string" ||
    typeof payload?.exp !== "number"
  ) {
    return { ok: false, reason: "invalid_format" };
  }

  const now = options.now ?? Date.now();
  if (payload.exp <= now) return { ok: false, reason: "expired" };

  if (options.expectedProvider && payload.provider !== options.expectedProvider) {
    return { ok: false, reason: "provider_mismatch" };
  }
  if (options.expectedUserId && payload.userId !== options.expectedUserId) {
    return { ok: false, reason: "user_mismatch" };
  }
  if (options.expectedWorkspaceId && payload.workspaceId !== options.expectedWorkspaceId) {
    return { ok: false, reason: "workspace_mismatch" };
  }
  if (options.expectedNonce !== undefined) {
    if (!options.expectedNonce || !constantTimeEquals(payload.nonce, options.expectedNonce)) {
      return { ok: false, reason: "nonce_mismatch" };
    }
  }

  return { ok: true, payload };
}

/** A donde se puede volver despues de conectar. */
const REDIRECT_ALLOWLIST = [
  "/dashboard/settings/integrations",
  "/dashboard/channels",
  "/dashboard/social",
  "/dashboard/content",
];

/**
 * Valida la direccion de retorno.
 *
 * Solo rutas internas y de una lista corta. Sin esto, el `redirect_to` seria
 * un redirector abierto: un link nuestro que lleva a cualquier lado, que es
 * justo lo que se usa para que una direccion parezca confiable.
 */
export function safeRedirect(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return REDIRECT_ALLOWLIST[0];
  }
  const path = value.split("?")[0].replace(/\/+$/, "");
  return REDIRECT_ALLOWLIST.includes(path) ? value : REDIRECT_ALLOWLIST[0];
}

export const OAUTH_STATE_COOKIE = "ssa_oauth_nonce";
