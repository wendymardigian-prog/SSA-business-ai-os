"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { checkResendLive, clearWebhookSecret, connectWebhookForWorkspace, saveReceiving, saveWebhookSecret } from "@/lib/email/resend-connection";
import { workspaceResendDomains } from "@/lib/email/resend-domains";
import type { LiveResult } from "@/lib/email/resend-status";
import type { ResendDomain } from "@/lib/email/senders";

/**
 * La tarjeta Resend (conexion de Resend): el webhook. Todo pide `integrations.manage` (el mismo permiso que configurar
 * Resend) y el negocio sale de la sesion. La key y el secreto se leen y se guardan en el servidor (Vault) y nunca
 * vuelven al navegador: lo unico que vuelve es que paso.
 */

const NO_PERMISSION = "No tenés permiso para configurar Resend";
const PATH = "/dashboard/settings/integrations";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const ACTION_MESSAGES = {
  created: "Webhook creado en Resend y secreto guardado.",
  adopted: "Había un webhook de SSA creado a mano: lo adopté y le sumé los eventos que faltaban.",
  updated: "Webhook actualizado: ya tiene todos los eventos.",
  unchanged: "El webhook ya estaba bien conectado.",
} as const;

/** "Conectar webhook automaticamente" / "Actualizar webhook": crea, adopta o arregla el de SSA. Nunca toca otro. */
export async function connectResendWebhookAction(): Promise<Result & { needsSecret?: boolean }> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const outcome = await connectWebhookForWorkspace({ service: await createServiceClient(), workspaceId: ctx.workspace.id });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { provider: "resend", kind: "resend_webhook", result: outcome.action, needs_secret: outcome.needsSecret },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH, "layout");

  const message = outcome.needsSecret
    ? "El webhook está conectado, pero Resend no devolvió su secreto: pegá el Signing secret abajo (o borralo en Resend y tocá Conectar de nuevo)."
    : ACTION_MESSAGES[outcome.action] + (outcome.disabled ? " Ojo: está desactivado en Resend; activalo en resend.com/webhooks." : "");
  return { ok: true, message, needsSecret: outcome.needsSecret };
}

/** El plan B: pegar el Signing secret (`whsec_…`) de un webhook creado a mano. */
export async function saveResendWebhookSecretAction(input: { secret: string }): Promise<Result> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const saved = await saveWebhookSecret({ service: await createServiceClient(), workspaceId: ctx.workspace.id, secret: String(input?.secret ?? "") });
  if (!saved.ok) return saved;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    // Nunca el valor: solo que se roto.
    metadata: { provider: "resend", kind: "resend_webhook_secret", secrets_rotated: ["webhook_secret"] },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH, "layout");
  return { ok: true, message: "Secreto guardado." };
}

/** "Quitar secreto": desde ahi los avisos de Resend se rechazan hasta volver a conectar. */
export async function clearResendWebhookSecretAction(): Promise<Result> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const cleared = await clearWebhookSecret(await createServiceClient(), ctx.workspace.id);
  if (!cleared.ok) return cleared;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { provider: "resend", kind: "resend_webhook_secret_cleared" },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH, "layout");
  return { ok: true, message: "Secreto quitado. Los avisos de Resend se van a rechazar hasta que vuelvas a conectar el webhook." };
}

/**
 * "Recibir emails en la bandeja" (R4): prende o apaga la recepcion por dominio. Pide `integrations.manage` (antes, con
 * la tarjeta "Resend (email entrante)", alcanzaba `channels.manage`: ver docs/PROGRESS-resend-conexion.md).
 */
export async function saveResendReceivingAction(input: {
  enabled: boolean;
  domain: string;
  local: string;
}): Promise<{ ok: true; message: string; warnings: string[] } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const service = await createServiceClient();
  const outcome = await saveReceiving({
    service,
    workspaceId: ctx.workspace.id,
    enabled: input?.enabled === true,
    domain: String(input?.domain ?? ""),
    local: String(input?.local ?? ""),
  });
  if (!outcome.ok) return outcome;

  // Una cuenta de email nueva: los roles que eligen cuenta por cuenta no la ven (00249). Nunca lanza.
  if (outcome.channelCreated) {
    const { notifyNewChannelAccess } = await import("@/lib/channels/new-channel-access");
    await notifyNewChannelAccess(service, { workspaceId: ctx.workspace.id, ...outcome.channelCreated });
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { provider: "resend", kind: "resend_receiving", enabled: outcome.enabled },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH, "layout");
  revalidatePath("/dashboard/inbox", "layout");

  return {
    ok: true,
    message: outcome.enabled
      ? `Listo: los emails a cualquier dirección de ese dominio entran a la bandeja. Para escribir primero se usa ${outcome.address}.`
      : "Recepción apagada. Las conversaciones que ya entraron quedan en la bandeja.",
    warnings: outcome.warnings,
  };
}

/**
 * "Probar" (R5): la key, el webhook y los dominios contra Resend, SOLO lectura. No crea, no cambia y no manda nada.
 */
export async function checkResendConnectionAction(): Promise<
  { ok: true; live: LiveResult; domains: ResendDomain[] | null } | { ok: false; error: string }
> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const [live, listed] = await Promise.all([
    checkResendLive({ service, workspaceId: ctx.workspace.id }),
    workspaceResendDomains(service as never, ctx.workspace.id, { refresh: true }),
  ]);
  return { ok: true, live, domains: listed.ok ? listed.domains : null };
}
