"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { getEvolutionConfig, getEvolutionWebhookToken } from "@/lib/evolution-config";
import { EvolutionError, findInstanceSettings, setCallSettings, setWebhook } from "@/lib/evolution-client";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { MAX_CALL_MESSAGE, normalizeCallMessage } from "@/lib/whatsapp-calls/settings";

/**
 * Las llamadas de un numero de WhatsApp (00258): rechazarlas solas y el
 * mensaje que se manda al rechazar. Viven en Evolution (`/settings`), no en
 * nuestra base: Evolution es quien las rechaza.
 *
 * Pide `channels.manage`. Guardar tambien vuelve a registrar el webhook de la
 * instancia con el evento CALL: un numero conectado antes de esta version no
 * lo recibia.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ALLOWED = "Tu rol no puede cambiar los canales.";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function loadChannel(channelId: string) {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { error: NOT_ALLOWED } as const;
  const service = await createServiceClient();
  const { data: channel } = await service
    .from("channels")
    .select("id, provider, evolution_instance")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!channel || channel.provider !== "evolution" || !channel.evolution_instance) return { error: "Ese número de WhatsApp no existe." } as const;
  const config = await getEvolutionConfig(service, ctx.workspace.id);
  if (!config) return { error: "WhatsApp no está configurado en este sistema." } as const;
  return { ctx, service, channel, instance: channel.evolution_instance, config } as const;
}

export async function getWhatsappCallSettings(channelId: string): Promise<Result<{ rejectCall: boolean; msgCall: string }>> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const loaded = await loadChannel(channelId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_ALLOWED };
  try {
    const settings = await findInstanceSettings(loaded.config, loaded.instance);
    return { ok: true, rejectCall: settings.rejectCall, msgCall: settings.msgCall };
  } catch (err) {
    console.error("[llamadas] no pude leer los ajustes:", err instanceof EvolutionError ? err.message : String(err));
    return { ok: false, error: "No pude leer los ajustes de este número. ¿Está conectado?" };
  }
}

export async function saveWhatsappCallSettings(
  channelId: string,
  input: { rejectCall: boolean; msgCall: string },
): Promise<Result> {
  if (!UUID.test(channelId ?? "") || typeof input?.rejectCall !== "boolean") return { ok: false, error: "Pedido inválido." };
  const msgCall = normalizeCallMessage(input.msgCall);
  if (msgCall === null) return { ok: false, error: `El mensaje puede tener hasta ${MAX_CALL_MESSAGE} caracteres.` };
  const loaded = await loadChannel(channelId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_ALLOWED };
  const { ctx, service, config, instance } = loaded;

  let before: { rejectCall: boolean; msgCall: string } | null = null;
  try {
    const current = await findInstanceSettings(config, instance);
    before = { rejectCall: current.rejectCall, msgCall: current.msgCall };
    await setCallSettings(config, instance, { rejectCall: input.rejectCall, msgCall: input.rejectCall ? msgCall : "" });
  } catch (err) {
    console.error("[llamadas] no pude guardar los ajustes:", err instanceof EvolutionError ? err.message : String(err));
    return { ok: false, error: "No pude guardar en Evolution. Probá de nuevo en un minuto." };
  }

  // De paso, que el webhook de esta instancia reciba el evento CALL. Si falla,
  // los ajustes ya quedaron: se avisa en el log y no se frena.
  try {
    const token = await getEvolutionWebhookToken(service, ctx.workspace.id);
    if (token) await setWebhook(config, instance, channelWebhookUrl("evolution"), token);
  } catch (err) {
    console.error("[llamadas] no pude actualizar el webhook:", err instanceof Error ? err.message : String(err));
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: "update",
    changes: {
      reject_call: { old: before?.rejectCall ?? null, new: input.rejectCall },
      msg_call: { old: before?.msgCall ? "(mensaje)" : null, new: input.rejectCall && msgCall ? "(mensaje)" : null },
    },
    metadata: { section: "whatsapp_calls" },
    performedBy: ctx.user.id,
  });
  return { ok: true };
}
