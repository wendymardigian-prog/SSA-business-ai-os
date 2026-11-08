"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { getEvolutionConfig, getEvolutionWebhookToken } from "@/lib/evolution-config";
import { EvolutionError, ensureGroupsNotIgnored, fetchAllGroups, setWebhook } from "@/lib/evolution-client";
import { ownerJidOf, refreshSavedGroup, syncChannelGroups } from "@/lib/whatsapp-groups/refresh";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { normalizeGroupJid } from "@/lib/phone";
import { scheduleJob } from "@/lib/scheduler";
import { mergeGroupLists, type GroupListItem } from "@/lib/whatsapp-groups/settings";
import { GROUP_IMPORT_JOB, groupImportDedupeKey } from "@/lib/whatsapp-groups/import";

/**
 * Los grupos de un numero de WhatsApp (00280), en su tarjeta de canal: cuales se ven en la bandeja, cuales guardan
 * como contacto a quien se une, e «Importar miembros».
 *
 * Pide `channels.manage`. Escribe con el cliente de servicio DESPUES del permiso, filtrando por el workspace de la
 * sesion. Activar un grupo tambien vuelve a registrar el webhook (con el evento de miembros) y se asegura de que
 * Evolution no ignore los grupos: un numero conectado antes de esta version no los recibia.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ALLOWED = "Tu rol no puede cambiar los canales.";
const MAX_SUBJECT = 200;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function loadChannel(channelId: string) {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { error: NOT_ALLOWED } as const;
  const service = await createServiceClient();
  const { data: channel } = await service
    .from("channels")
    .select("id, workspace_id, provider, evolution_instance")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!channel || channel.provider !== "evolution" || !channel.evolution_instance) return { error: "Ese número de WhatsApp no existe." } as const;
  const config = await getEvolutionConfig(service, ctx.workspace.id);
  if (!config) return { error: "WhatsApp no está configurado en este sistema." } as const;
  return { ctx, service, channel, instance: channel.evolution_instance, config } as const;
}

/** Los grupos del numero, con lo que el negocio activo en cada uno. */
export async function listWhatsappGroups(channelId: string): Promise<Result<{ groups: GroupListItem[] }>> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const loaded = await loadChannel(channelId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_ALLOWED };
  const { service, ctx, config, instance } = loaded;

  const { data: saved } = await service
    .from("whatsapp_groups")
    .select("id, group_jid, subject, in_inbox, save_contacts, left_at, kind, parent_group_jid, community_subject")
    .eq("channel_id", channelId)
    .eq("workspace_id", ctx.workspace.id);

  try {
    // Con el numero, Evolution trae tambien los miembros: asi se sabe en que grupos es admin.
    const ownerJid = await ownerJidOf(config, instance);
    const live = await fetchAllGroups(config, instance, { ownerJid });
    // Todos los grupos del numero van a la bandeja: los nuevos se suman y lo guardado queda al dia. Nunca frena.
    await syncChannelGroups(service, { workspaceId: ctx.workspace.id, channelId, live });
    // Y que Evolution no los ignore (un numero conectado antes de los grupos los ignoraba). Si falla, se sigue.
    try {
      await ensureGroupsNotIgnored(config, instance);
    } catch (err) {
      console.error("[grupos] no pude pedirle a Evolution que no ignore los grupos:", err instanceof Error ? err.message : String(err));
    }
    const { data: synced } = await service
      .from("whatsapp_groups")
      .select("id, group_jid, subject, in_inbox, save_contacts, left_at, kind, parent_group_jid, community_subject")
      .eq("channel_id", channelId)
      .eq("workspace_id", ctx.workspace.id);
    return { ok: true, groups: mergeGroupLists(live, synced ?? saved ?? []) };
  } catch (err) {
    console.error("[grupos] no pude leer los grupos:", err instanceof EvolutionError ? err.message : String(err));
    return { ok: false, error: "No pude leer los grupos de este número. ¿Está conectado?" };
  }
}

/**
 * Guarda si un grupo suma como contacto a quien se une. Desde el 8/11/2026 todos los grupos del numero van a la
 * bandeja: `in_inbox` queda siempre prendido y ya no se elige.
 */
export async function saveWhatsappGroup(
  channelId: string,
  input: { jid: string; subject: string; saveContacts: boolean },
): Promise<Result<{ groupId: string }>> {
  const jid = normalizeGroupJid(input?.jid);
  if (!UUID.test(channelId ?? "") || !jid || typeof input.saveContacts !== "boolean") {
    return { ok: false, error: "Pedido inválido." };
  }
  const subject = (input.subject ?? "").trim().slice(0, MAX_SUBJECT) || jid;
  const loaded = await loadChannel(channelId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_ALLOWED };
  const { ctx, service, config, instance } = loaded;

  const { data: before } = await service
    .from("whatsapp_groups")
    .select("id, in_inbox, save_contacts")
    .eq("channel_id", channelId)
    .eq("group_jid", jid)
    .maybeSingle();

  const { data: row, error } = await service
    .from("whatsapp_groups")
    .upsert(
      {
        workspace_id: ctx.workspace.id,
        channel_id: channelId,
        group_jid: jid,
        subject,
        in_inbox: true,
        save_contacts: input.saveContacts,
        left_at: null,
      },
      { onConflict: "channel_id,group_jid" },
    )
    .select("id")
    .single();
  if (error || !row) {
    console.error("[grupos] no pude guardar el grupo:", error?.message);
    return { ok: false, error: "No pude guardar el grupo. Probá de nuevo." };
  }

  // Que Evolution avise lo de los grupos. Si falla, el grupo ya quedo guardado: se avisa en el log y no se frena.
  {
    // Comunidad, permisos y si el numero es admin, para la bandeja. Nunca lanza.
    await refreshSavedGroup(service, { workspaceId: ctx.workspace.id, channelId, groupJid: jid, config, instance });
    try {
      await ensureGroupsNotIgnored(config, instance);
      const token = await getEvolutionWebhookToken(service, ctx.workspace.id);
      if (token) await setWebhook(config, instance, channelWebhookUrl("evolution"), token);
    } catch (err) {
      console.error("[grupos] no pude preparar Evolution para los grupos:", err instanceof Error ? err.message : String(err));
    }
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: "update",
    changes: {
      save_contacts: { old: before?.save_contacts ?? null, new: input.saveContacts },
    },
    metadata: { section: "whatsapp_groups", group_id: row.id },
    performedBy: ctx.user.id,
  });
  return { ok: true, groupId: row.id };
}

/** Encola «Importar miembros». Dos clics seguidos encolan una sola importacion. */
export async function importWhatsappGroupMembers(channelId: string, groupId: string): Promise<Result> {
  if (!UUID.test(channelId ?? "") || !UUID.test(groupId ?? "")) return { ok: false, error: "Pedido inválido." };
  const loaded = await loadChannel(channelId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_ALLOWED };
  const { ctx, service } = loaded;

  const { data: group } = await service
    .from("whatsapp_groups")
    .select("id, left_at")
    .eq("id", groupId)
    .eq("channel_id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!group || group.left_at) return { ok: false, error: "Primero activá el grupo." };

  try {
    await scheduleJob(
      service,
      GROUP_IMPORT_JOB,
      { workspaceId: ctx.workspace.id, groupId, requestedBy: ctx.user.id },
      new Date(),
      groupImportDedupeKey(groupId),
    );
  } catch (err) {
    // 23505 = ya hay una importacion de este grupo en la cola: no es un error.
    if ((err as { code?: string })?.code !== "23505") {
      console.error("[grupos] no pude encolar la importacion:", err instanceof Error ? err.message : String(err));
      return { ok: false, error: "No pude empezar la importación. Probá de nuevo." };
    }
  }
  return { ok: true };
}
