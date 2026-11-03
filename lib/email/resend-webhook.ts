/**
 * El webhook de Resend de SSA (conexion de Resend, R2).
 *
 * Mismo espiritu que `lib/zernio-webhook.ts`: SSA registra solo su webhook, con la key del negocio. Con una
 * diferencia que importa: en una cuenta de Resend puede haber webhooks de OTROS sistemas (y de otro negocio de la
 * misma instalacion). SSA administra SOLO el suyo:
 *
 * - "El suyo" es el que apunta EXACTAMENTE al receptor de esta app: mismo origen, mismo camino, y sin query o con
 *   `?w=` de este negocio (`ownershipOf`). Uno con `w=` de otro negocio es de ese negocio.
 * - Nunca se borra un webhook: este modulo ni siquiera sabe hacerlo.
 * - Un webhook propio creado a mano (sin `?w=`) se ADOPTA: se le pone la URL con `?w=` y la union de sus eventos con
 *   los nuestros (no se le saca ninguno que la persona haya marcado; `PATCH` reemplaza la lista).
 *
 * El secreto (`signing_secret`) lo devuelve Resend al crear y al pedir UN webhook por id; la lista no es confiable
 * para eso. Si igual no viene, el resultado lo dice y la pantalla pide pegarlo.
 *
 * Solo servidor: usa la key.
 */

import { resendRequest, type ResendApiFailure } from "./resend-api";
import { RESEND_WEBHOOK_EVENTS_LIST } from "./resend-events";
import { RESEND_WORKSPACE_PARAM } from "@/lib/webhook-url";

/** Los eventos que usa SSA: la lista unica vive en `resend-events.ts`. */
export const RESEND_WEBHOOK_EVENTS = RESEND_WEBHOOK_EVENTS_LIST;

export interface ResendWebhook {
  id: string;
  endpoint: string;
  events: string[];
  status: string | null;
}

/** De quien es un webhook, mirando solo su URL. Puro. */
export type WebhookOwnership = "mine" | "legacy" | "other_workspace" | "foreign";

/**
 * - `mine`: la URL de SSA con `?w=` de este negocio.
 * - `legacy`: la URL de SSA sin query (la de siempre, o creada a mano): es de SSA y se adopta.
 * - `other_workspace`: la URL de SSA con `?w=` de OTRO negocio. No se toca.
 * - `foreign`: cualquier otra cosa (otro camino, otro dominio, otra query). No se toca.
 *
 * `receiverUrl` es la URL del receptor SIN query.
 */
export function ownershipOf(endpoint: string, receiverUrl: string, workspaceId: string): WebhookOwnership {
  let target: URL;
  let ours: URL;
  try {
    target = new URL(endpoint.trim());
    ours = new URL(receiverUrl.trim());
  } catch {
    return "foreign";
  }
  const path = (u: URL) => u.pathname.replace(/\/+$/, "") || "/";
  if (target.origin.toLowerCase() !== ours.origin.toLowerCase() || path(target) !== path(ours)) return "foreign";
  if (target.hash) return "foreign";

  const keys = [...target.searchParams.keys()];
  if (keys.length === 0) return "legacy";
  if (keys.length !== 1 || keys[0] !== RESEND_WORKSPACE_PARAM) return "foreign";
  return target.searchParams.get(RESEND_WORKSPACE_PARAM) === workspaceId ? "mine" : "other_workspace";
}

/** Los eventos nuestros que le faltan a un webhook. Puro. */
export function missingEvents(events: readonly string[]): string[] {
  const have = new Set(events);
  return RESEND_WEBHOOK_EVENTS.filter((e) => !have.has(e));
}

interface RawWebhook {
  id?: string;
  endpoint?: string;
  events?: string[] | null;
  status?: string | null;
  signing_secret?: string | null;
}

function toWebhook(raw: RawWebhook): ResendWebhook | null {
  if (!raw?.id || !raw.endpoint) return null;
  return { id: raw.id, endpoint: raw.endpoint, events: Array.isArray(raw.events) ? raw.events : [], status: raw.status ?? null };
}

const MAX_PAGES = 10;

/** Todos los webhooks de la cuenta (paginado). Solo lectura. */
export async function listResendWebhooks(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; webhooks: ResendWebhook[] } | { ok: false; reason: ResendApiFailure }> {
  const webhooks: ResendWebhook[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs: string = `?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await resendRequest<{ data?: RawWebhook[]; has_more?: boolean }>(apiKey, "GET", `/webhooks${qs}`, undefined, fetchImpl);
    if (!res.ok) return { ok: false, reason: res.reason };
    const items = (res.data.data ?? []).map(toWebhook).filter((w): w is ResendWebhook => w !== null);
    webhooks.push(...items);
    if (!res.data.has_more || items.length === 0) break;
    after = items[items.length - 1].id;
  }
  return { ok: true, webhooks };
}

/** El webhook de SSA de este negocio que hay en la cuenta (el propio gana sobre uno sin `?w=`), o null. Puro. */
export function findOurWebhook(
  webhooks: ResendWebhook[],
  receiverUrl: string,
  workspaceId: string,
): { webhook: ResendWebhook; ownership: "mine" | "legacy" } | null {
  for (const wanted of ["mine", "legacy"] as const) {
    const found = webhooks.find((w) => ownershipOf(w.endpoint, receiverUrl, workspaceId) === wanted);
    if (found) return { webhook: found, ownership: wanted };
  }
  return null;
}

export type ConnectWebhookResult =
  | {
      ok: true;
      /** `created`: no habia ninguno. `adopted`: habia uno de SSA sin `?w=` (o de antes). `updated`: el nuestro, con eventos o URL que arreglar. `unchanged`: ya estaba bien. */
      action: "created" | "adopted" | "updated" | "unchanged";
      webhookId: string;
      events: string[];
      /** El `signing_secret`, si Resend lo devolvio. Null: hay que pegarlo a mano. */
      secret: string | null;
      /** Desactivado en Resend (no se reactiva solo: lo decide la persona en Resend). */
      disabled: boolean;
    }
  | { ok: false; reason: ResendApiFailure };

/**
 * Crea o adopta el webhook de SSA de este negocio. `url` es la URL con `?w=`; `receiverUrl`, la misma sin query.
 *
 * Solo escribe sobre el webhook propio (`mine`/`legacy`); ningun otro id sale de aca hacia un `PATCH`.
 */
export async function connectResendWebhook(params: {
  apiKey: string;
  workspaceId: string;
  url: string;
  receiverUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectWebhookResult> {
  const { apiKey, workspaceId, url, receiverUrl } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  const listed = await listResendWebhooks(apiKey, fetchImpl);
  if (!listed.ok) return listed;

  const found = findOurWebhook(listed.webhooks, receiverUrl, workspaceId);

  if (!found) {
    const created = await resendRequest<RawWebhook>(apiKey, "POST", "/webhooks", { endpoint: url, events: [...RESEND_WEBHOOK_EVENTS] }, fetchImpl);
    if (!created.ok) return { ok: false, reason: created.reason };
    if (!created.data.id) return { ok: false, reason: "failed" };
    return {
      ok: true,
      action: "created",
      webhookId: created.data.id,
      events: [...RESEND_WEBHOOK_EVENTS],
      secret: created.data.signing_secret?.trim() || null,
      disabled: false,
    };
  }

  const { webhook, ownership } = found;
  const events = [...new Set([...webhook.events, ...RESEND_WEBHOOK_EVENTS])];
  const needsUpdate = webhook.endpoint.trim() !== url || missingEvents(webhook.events).length > 0;

  if (needsUpdate) {
    const patched = await resendRequest<RawWebhook>(apiKey, "PATCH", `/webhooks/${encodeURIComponent(webhook.id)}`, { endpoint: url, events }, fetchImpl);
    if (!patched.ok) return { ok: false, reason: patched.reason };
  }

  // El secreto: se pide el webhook por id (la lista no lo trae siempre).
  const detail = await resendRequest<RawWebhook>(apiKey, "GET", `/webhooks/${encodeURIComponent(webhook.id)}`, undefined, fetchImpl);
  const secret = detail.ok ? detail.data.signing_secret?.trim() || null : null;

  return {
    ok: true,
    action: ownership === "legacy" ? "adopted" : needsUpdate ? "updated" : "unchanged",
    webhookId: webhook.id,
    events,
    secret,
    disabled: webhook.status === "disabled",
  };
}

/** El estado del webhook de SSA en la cuenta, para "Probar" (solo lectura). */
export async function inspectResendWebhook(params: {
  apiKey: string;
  workspaceId: string;
  receiverUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; found: false }
  | { ok: true; found: true; webhookId: string; ownership: "mine" | "legacy"; missing: string[]; disabled: boolean }
  | { ok: false; reason: ResendApiFailure }
> {
  const listed = await listResendWebhooks(params.apiKey, params.fetchImpl);
  if (!listed.ok) return listed;
  const found = findOurWebhook(listed.webhooks, params.receiverUrl, params.workspaceId);
  if (!found) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    webhookId: found.webhook.id,
    ownership: found.ownership,
    missing: missingEvents(found.webhook.events),
    disabled: found.webhook.status === "disabled",
  };
}

/** Un `signing_secret` con forma valida (`whsec_` + base64 que decodifica a algo). Puro. */
export function isValidSigningSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("whsec_")) return false;
  const body = trimmed.slice("whsec_".length);
  if (body.length < 16 || !/^[A-Za-z0-9+/=]+$/.test(body)) return false;
  return Buffer.from(body, "base64").length >= 12;
}
