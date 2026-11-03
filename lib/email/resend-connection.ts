/**
 * El nucleo de la tarjeta Resend (conexion de Resend): conectar el webhook, guardar su secreto, la recepcion por
 * dominio y el estado para "Probar".
 *
 * Recibe el cliente de servicio: quien llama YA chequeo `integrations.manage` y saca el workspace de la sesion. Lo
 * llaman las Server Actions (lib/actions/resend-connection.ts) y `saveIntegration` (al guardar una key de acceso
 * completo). La key de Resend se lee de Vault aca y nunca sale de este modulo.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, storeSecret, deleteSecret, listSecretNames, SECRET_NAMES } from "@/lib/vault";
import { channelWebhookUrl, resendWebhookUrl } from "@/lib/webhook-url";
import { connectResendWebhook, inspectResendWebhook, isValidSigningSecret } from "./resend-webhook";
import { probeResendKey, type ResendApiFailure } from "./resend-api";
import { readResendConnection, type ResendConnectionKey, type ResendConnectionState } from "./resend-config";

type Db = SupabaseClient<Database>;

/** Los mensajes de cada falla, para la pantalla. Nunca llevan la key. */
export const RESEND_FAILURE_MESSAGES: Record<ResendApiFailure | "no_key" | "local_url" | "vault", string> = {
  no_key: "Primero guardá la API key de Resend.",
  restricted:
    "Tu API key es de «solo envío»: no deja administrar webhooks. Creá el webhook a mano en resend.com/webhooks (los pasos están abajo) y pegá su Signing secret, o cargá una key de acceso completo.",
  invalid_key: "Resend rechazó la API key (revocada o desactivada). Cargá una nueva arriba.",
  failed: "Resend no respondió. Probá de nuevo en unos minutos o crealo a mano con los pasos de abajo.",
  local_url:
    "La app no tiene un dominio público configurado (NEXT_PUBLIC_APP_URL): Resend no podría llegar. Configuralo antes de conectar el webhook.",
  vault: "No pude guardar el secreto de forma segura. Probá de nuevo.",
};

export interface ResendRow {
  config: Record<string, unknown>;
  isActive: boolean;
  lastEventAt: string | null;
}

/** La fila `resend` del negocio, o null. */
export async function loadResendRow(service: Db, workspaceId: string): Promise<ResendRow | null> {
  const { data, error } = await service
    .from("integration_configs")
    .select("config, is_active, last_event_at")
    .eq("workspace_id", workspaceId)
    .eq("type", "email_provider")
    .eq("provider", "resend")
    .maybeSingle();
  if (error) throw new Error(`[resend] no pude leer la configuracion: ${error.message}`);
  if (!data) return null;
  const row = data as { config: unknown; is_active: boolean; last_event_at: string | null };
  const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : {};
  return { config, isActive: row.is_active, lastEventAt: row.last_event_at ?? null };
}

/**
 * Cambia claves de la tarjeta Resend sin tocar las demas (un `null` borra la clave). Solo actualiza una fila que ya
 * existe: la crea `saveIntegration` al guardar la key.
 */
export async function patchResendConfig(
  service: Db,
  workspaceId: string,
  patch: Partial<Record<ResendConnectionKey, string | null>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadResendRow(service, workspaceId);
  if (!row) return { ok: false, error: RESEND_FAILURE_MESSAGES.no_key };
  const next: Record<string, unknown> = { ...row.config };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  const { error } = await service
    .from("integration_configs")
    .update({ config: next as never })
    .eq("workspace_id", workspaceId)
    .eq("type", "email_provider")
    .eq("provider", "resend");
  if (error) return { ok: false, error: `No pude guardar la configuración de Resend: ${error.message}` };
  return { ok: true };
}

/** Si el secreto del webhook esta en Vault. Una falla de Vault cuenta como "no se sabe" (null). */
export async function hasWebhookSecret(service: Db, workspaceId: string): Promise<boolean | null> {
  try {
    return (await listSecretNames(service, workspaceId)).includes(SECRET_NAMES.resendWebhookSecret);
  } catch {
    return null;
  }
}

export type ConnectOutcome =
  | { ok: true; action: "created" | "adopted" | "updated" | "unchanged"; needsSecret: boolean; disabled: boolean }
  | { ok: false; reason: keyof typeof RESEND_FAILURE_MESSAGES; error: string };

/**
 * Conecta (o adopta, o arregla) el webhook de SSA de este negocio y guarda su secreto en Vault. Nunca lanza.
 */
export async function connectWebhookForWorkspace(params: {
  service: Db;
  workspaceId: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ConnectOutcome> {
  const { service, workspaceId } = params;
  const now = (params.now ?? new Date()).toISOString();
  const fail = (reason: keyof typeof RESEND_FAILURE_MESSAGES): ConnectOutcome => ({ ok: false, reason, error: RESEND_FAILURE_MESSAGES[reason] });

  let apiKey: string | null;
  try {
    apiKey = await readSecret(service, workspaceId, SECRET_NAMES.resendApiKey);
  } catch {
    return fail("failed");
  }
  if (!apiKey) return fail("no_key");

  let url: string;
  let receiverUrl: string;
  try {
    url = resendWebhookUrl(workspaceId);
    receiverUrl = channelWebhookUrl("resend");
  } catch {
    return fail("local_url");
  }

  const res = await connectResendWebhook({ apiKey, workspaceId, url, receiverUrl, fetchImpl: params.fetchImpl });
  if (!res.ok) {
    if (res.reason === "restricted") await patchResendConfig(service, workspaceId, { access: "sending" }).catch(() => null);
    return fail(res.reason);
  }

  let secretSaved = false;
  if (res.secret) {
    const stored = await storeSecret(service, workspaceId, SECRET_NAMES.resendWebhookSecret, res.secret).catch(() => ({ ok: false as const, error: "vault" }));
    if (!stored.ok) return fail("vault");
    secretSaved = true;
  }

  // Sin secreto devuelto: si ya habia uno guardado (pegado antes) se confia en el; si no, hay que pegarlo.
  const needsSecret = !secretSaved && (await hasWebhookSecret(service, workspaceId)) !== true;
  const row = await loadResendRow(service, workspaceId).catch(() => null);
  const previous = row ? readResendConnection(row.config) : null;

  const patched = await patchResendConfig(service, workspaceId, {
    access: "full",
    webhook_id: res.webhookId,
    webhook_events: res.events.join(","),
    webhook_connected_at: previous?.webhook.id === res.webhookId && previous.webhook.connectedAt ? previous.webhook.connectedAt : now,
    webhook_secret_saved_at: secretSaved ? now : (previous?.webhook.secretSavedAt ?? null),
    webhook_needs_secret: needsSecret ? "true" : null,
    webhook_disabled: res.disabled ? "true" : null,
  });
  if (!patched.ok) return { ok: false, reason: "failed", error: patched.error };

  return { ok: true, action: res.action, needsSecret, disabled: res.disabled };
}

/** El plan B: el Signing secret pegado a mano (`whsec_…`). */
export async function saveWebhookSecret(params: {
  service: Db;
  workspaceId: string;
  secret: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = params.secret.trim();
  if (!isValidSigningSecret(secret)) {
    return { ok: false, error: "Ese no parece un Signing secret de Resend: empieza con «whsec_» y se copia entero desde el webhook en resend.com/webhooks." };
  }
  const stored = await storeSecret(params.service, params.workspaceId, SECRET_NAMES.resendWebhookSecret, secret).catch(() => ({ ok: false as const, error: "vault" }));
  if (!stored.ok) return { ok: false, error: RESEND_FAILURE_MESSAGES.vault };
  return patchResendConfig(params.service, params.workspaceId, {
    webhook_secret_saved_at: (params.now ?? new Date()).toISOString(),
    webhook_needs_secret: null,
  });
}

/** "Quitar secreto": los avisos dejan de validarse (y se rechazan) hasta volver a conectar. */
export async function clearWebhookSecret(service: Db, workspaceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const deleted = await deleteSecret(service, workspaceId, SECRET_NAMES.resendWebhookSecret).catch(() => ({ ok: false as const, error: "vault" }));
  if (!deleted.ok) return { ok: false, error: RESEND_FAILURE_MESSAGES.vault };
  return patchResendConfig(service, workspaceId, { webhook_secret_saved_at: null, webhook_needs_secret: null });
}

export interface ResendLiveCheck {
  key: { ok: true; access: "full" | "sending" } | { ok: false; error: string };
  webhook:
    | { checked: false; reason: string }
    | { checked: true; found: false }
    | { checked: true; found: true; missing: string[]; disabled: boolean };
}

/**
 * "Probar": la key y el webhook contra Resend, SOLO lectura (GET /domains y GET /webhooks). No crea, no cambia y no
 * manda nada. Los dominios los trae la pantalla aparte (`loadResendDomains`).
 */
export async function checkResendLive(params: { service: Db; workspaceId: string; fetchImpl?: typeof fetch }): Promise<ResendLiveCheck> {
  let apiKey: string | null = null;
  try {
    apiKey = await readSecret(params.service, params.workspaceId, SECRET_NAMES.resendApiKey);
  } catch {
    return { key: { ok: false, error: RESEND_FAILURE_MESSAGES.failed }, webhook: { checked: false, reason: RESEND_FAILURE_MESSAGES.failed } };
  }
  if (!apiKey) return { key: { ok: false, error: RESEND_FAILURE_MESSAGES.no_key }, webhook: { checked: false, reason: RESEND_FAILURE_MESSAGES.no_key } };

  const probe = await probeResendKey(apiKey, params.fetchImpl);
  if (!probe.ok) {
    const error = RESEND_FAILURE_MESSAGES[probe.reason];
    return { key: { ok: false, error }, webhook: { checked: false, reason: error } };
  }
  if (probe.access === "sending") {
    return { key: probe, webhook: { checked: false, reason: "La key es de solo envío: el webhook no se puede comprobar desde acá (miralo en resend.com/webhooks)." } };
  }

  let receiverUrl: string;
  try {
    receiverUrl = channelWebhookUrl("resend");
  } catch {
    return { key: probe, webhook: { checked: false, reason: RESEND_FAILURE_MESSAGES.local_url } };
  }
  const inspected = await inspectResendWebhook({ apiKey, workspaceId: params.workspaceId, receiverUrl, fetchImpl: params.fetchImpl });
  if (!inspected.ok) return { key: probe, webhook: { checked: false, reason: RESEND_FAILURE_MESSAGES[inspected.reason] } };
  if (!inspected.found) return { key: probe, webhook: { checked: true, found: false } };
  return { key: probe, webhook: { checked: true, found: true, missing: inspected.missing, disabled: inspected.disabled } };
}

export type { ResendConnectionState };
