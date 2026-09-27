/**
 * Zernio webhook auto-registration.
 *
 * El sistema registra en Zernio la URL a la que quiere recibir los eventos
 * (DMs, comentarios). Zernio expone un solo webhook por perfil/API key, asi que
 * esto es idempotente y trabaja a nivel workspace (el secreto vive en
 * Vault, `zernio_webhook_secret`).
 *
 * Que URL se registra lo decide quien llama (lib/webhook-url.ts): el receptor
 * de la app, `${NEXT_PUBLIC_APP_URL}/api/webhooks/late`. Es el unico receptor
 * del sistema, porque el motor de flows corre ahi.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret, storeSecret, SECRET_NAMES } from "@/lib/vault";
import type { Zernio } from "./zernio-client";

/** Name used to identify Zernflow's webhook among a profile's webhooks. */
export const WEBHOOK_NAME = "Zernflow";

/** Events Zernflow needs delivered to its webhook. */
export type WebhookEvent =
  | "message.received"
  | "comment.received"
  | "message.sent"
  | "post.platform.published"
  | "post.platform.failed";

/**
 * Eventos que la app se suscribe. `message.sent` trae los ecos de lo que se
 * mandó fuera de la app (la doc del SDK: "operator replied from the native
 * app"), que hoy no llegan por webhook. Se guarda como saliente `external`
 * (F2). El refresco contra Zernio (Bloque 2) cubre igual el caso por si el
 * proveedor no dispara el eco de ManyChat.
 *
 * Los dos de `post.platform.*` son como se entera el sistema de que una
 * publicacion salio o fallo (A7). El receptor ya sabia leerlos
 * (`lib/publishing/inbound.ts`) pero nunca llegaban, porque nadie los habia
 * pedido: el estado solo aparecia si alguien preguntaba a los 2, 12 y 42
 * minutos. Con Zernio programando de su lado (grupo D) esto pasa a ser el
 * camino principal, no el atajo.
 */
export const SUBSCRIBED_EVENTS: WebhookEvent[] = [
  "message.received",
  "comment.received",
  "message.sent",
  "post.platform.published",
  "post.platform.failed",
];

export interface EnsureWebhookOptions {
  /**
   * URL publica a la que Zernio tiene que entregar los eventos.
   *
   * La arma lib/webhook-url.ts desde NEXT_PUBLIC_APP_URL, que se niega a
   * registrar una direccion local: un webhook apuntando a localhost no falla,
   * simplemente no entra nada.
   */
  url: string;
  /** Workspace-level HMAC secret used to verify webhook signatures. */
  secret: string;
  /** Events to subscribe to (at least one). */
  events: WebhookEvent[];
}

export interface EnsureWebhookResult {
  action: "created" | "updated" | "unchanged";
}

/** Minimal shape of a Zernio webhook entry (subset of the SDK's Webhook type). */
interface ZernioWebhook {
  _id?: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
}

function webhookUrl(url: string): string {
  // trim() protege contra espacios colados desde una variable de entorno: un
  // salto de linea al final registro una vez un webhook con "\n" en la URL y
  // todas las entregas fallaban en silencio (#10).
  return url.trim().replace(/\/$/, "");
}

/** Normalizes a URL to origin+pathname, dropping query string and trailing slash. */
function normalizePath(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return u.replace(/\?.*$/, "").replace(/\/$/, "");
  }
}

/** True when two webhook URLs share the same origin+path, ignoring query string. */
function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && normalizePath(a) === normalizePath(b);
}

/**
 * Ensures Zernflow's webhook is registered in Zernio and up to date.
 *
 * - No webhook found → create it.
 * - Found but URL differs or an event is missing → update it.
 * - Found and correct → no-op.
 *
 * Identifying "our" webhook: match by path (ignoring any query string, since a
 * webhook registered by hand may carry an SSO bypass token in the URL) or by
 * name. Never adopt anything else: Zernio allows up to 10 webhooks per account,
 * so an unmatched entry belongs to another integration the user owns and
 * rewriting it would silently break that integration.
 */
export async function ensureWebhookRegistered(
  zernio: Zernio,
  opts: EnsureWebhookOptions,
): Promise<EnsureWebhookResult> {
  const url = webhookUrl(opts.url);

  const res = await zernio.webhooks.getWebhookSettings();
  const webhooks = (res?.data?.webhooks ?? []) as ZernioWebhook[];
  const mine = webhooks.find((w) => samePath(w.url, url) || w.name === WEBHOOK_NAME);

  if (!mine) {
    await zernio.webhooks.createWebhookSettings({
      body: { name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "created" };
  }

  const eventsOk = opts.events.every((e) => mine.events?.includes(e));
  // Zernio's GET returns the stored secret, so drift is detectable. Without
  // this check a secret rotated locally (e.g. the workspace column arriving
  // after the webhook was first registered) never reaches Zernio and every
  // delivery fails signature verification from then on.
  const secretOk = (mine.secret || "") === opts.secret;
  if (mine.url !== url || !eventsOk || !secretOk) {
    await zernio.webhooks.updateWebhookSettings({
      body: { _id: mine._id!, name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "updated" };
  }

  return { action: "unchanged" };
}

/** Generates a random 32-byte secret as a 64-char hex string. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * El secreto del webhook del workspace, generandolo la primera vez.
 *
 * Vive en **Vault** (migracion 00090: las columnas viejas se borraron). Con
 * el mismo secreto se registra el webhook en Zernio y se verifica la firma
 * de lo que entra, asi que tiene que ser estable por workspace.
 *
 * Si no se puede guardar en Vault se lanza, y no se devuelve uno igual:
 * registrar en Zernio un secreto que no quedo guardado deja todos los
 * webhooks entrantes rechazados con 401, y sin nada que lo explique.
 */
export async function getOrCreateWorkspaceWebhookSecret(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const existing = await readSecret(supabase, workspaceId, SECRET_NAMES.zernioWebhookSecret);
  if (existing) return existing;

  const secret = generateWebhookSecret();
  const stored = await storeSecret(supabase, workspaceId, SECRET_NAMES.zernioWebhookSecret, secret);

  if (!stored.ok) {
    throw new Error(`No pude guardar el secreto del webhook: ${stored.error}`);
  }

  return secret;
}

/**
 * Verifies an inbound webhook's HMAC-SHA256 signature (x-late-signature header)
 * against the shared secret using a constant-time comparison.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

/**
 * Lo minimo que hace falta del canal para resolver el secreto.
 *
 * `webhook_secret` ya no esta: era la columna mas vieja de las tres y la
 * borro la 00090. Se conserva el campo opcional en el tipo para no obligar a
 * tocar los llamadores, pero no se lee.
 */
export interface ChannelSecretRef {
  workspace_id: string;
  webhook_secret?: string | null;
}

/**
 * Con que secreto se verifica la firma de un webhook entrante.
 *
 * **Solo Vault** (`zernio_webhook_secret`). Hasta la 00090 habia dos
 * respaldos —`workspaces.webhook_secret` y `channels.webhook_secret`— que
 * existian para que Instagram siguiera entrando mientras el secreto no se
 * hubiera movido. El secreto se movio, las columnas se borraron, y los
 * respaldos con ellas.
 *
 * Devuelve null si no hay secreto, y entonces el receptor rechaza con 401:
 * esta URL es publica y aceptar sin verificar seria peor que no recibir.
 */
export async function resolveWebhookSecret(
  supabase: SupabaseClient,
  channel: ChannelSecretRef,
): Promise<string | null> {
  try {
    return await readSecret(supabase, channel.workspace_id, SECRET_NAMES.zernioWebhookSecret);
  } catch (err) {
    // Vault caido: se rechaza el webhook en vez de aceptarlo sin verificar.
    console.error(
      "[webhook] no pude leer el secreto de Vault:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
