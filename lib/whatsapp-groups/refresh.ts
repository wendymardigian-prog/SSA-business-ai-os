/**
 * Mantiene al dia lo que se guarda de cada grupo activado (nombre, foto, miembros, permisos, si el numero es admin y
 * su comunidad, 00344) con lo que dice WhatsApp. Solo servidor: escribe con el cliente de servicio que le pasan.
 *
 * Nunca lanza: si no se puede refrescar, el grupo sigue funcionando con lo que ya tenia guardado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { fetchGroupInfo, fetchInstanceOwner, type EvolutionConfig, type EvolutionGroup } from "@/lib/evolution-client";
import { communityNames, liveGroupColumns } from "@/lib/whatsapp-groups/settings";

type Service = SupabaseClient<Database>;

/** El JID del numero, para saber en que grupos es admin. null si Evolution no lo dice (no frena nada). */
export async function ownerJidOf(config: EvolutionConfig, instance: string): Promise<string | null> {
  try {
    return await fetchInstanceOwner(config, instance);
  } catch (err) {
    console.error("[grupos] no pude leer el numero de la instancia:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Refresca UN grupo guardado preguntandole a WhatsApp (`findGroupInfos`, y el de su comunidad para el nombre).
 * Devuelve lo leido, o null si no se pudo.
 */
export async function refreshSavedGroup(
  service: Service,
  params: { workspaceId: string; channelId: string; groupJid: string; config: EvolutionConfig; instance: string; ownerJid?: string | null },
): Promise<EvolutionGroup | null> {
  try {
    const ownerJid = params.ownerJid === undefined ? await ownerJidOf(params.config, params.instance) : params.ownerJid;
    const group = await fetchGroupInfo(params.config, params.instance, params.groupJid, { ownerJid });
    if (!group || group.isCommunity) return group;
    let communitySubject: string | null = null;
    if (group.parentJid) {
      const parent = await fetchGroupInfo(params.config, params.instance, group.parentJid).catch(() => null);
      communitySubject = parent?.subject ?? null;
    }
    const columns = liveGroupColumns(group, communitySubject);
    // Sin el nombre de la comunidad no se pisa el que ya estaba guardado.
    const { community_subject: _keep, ...withoutCommunityName } = columns;
    const patch = group.parentJid && !communitySubject ? withoutCommunityName : columns;
    const { error } = await service
      .from("whatsapp_groups")
      .update(patch)
      .eq("workspace_id", params.workspaceId)
      .eq("channel_id", params.channelId)
      .eq("group_jid", group.jid);
    if (error) console.error("[grupos] no pude actualizar el grupo:", error.message);
    return group;
  } catch (err) {
    console.error("[grupos] no pude leer el grupo:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Todos los grupos del numero van a la bandeja (decision del 8/11/2026): deja una fila por grupo (nunca la comunidad
 * madre) con `in_inbox` prendido y los datos de WhatsApp al dia, y marca como dejados (`left_at`) los guardados de
 * los que el numero ya no es parte. `save_contacts` no se toca: eso lo elige el negocio.
 *
 * Solo se llama con la lista COMPLETA de `fetchAllGroups` (si fallo, no se llama: no se marca nada como dejado).
 * Nunca lanza.
 */
export async function syncChannelGroups(
  service: Service,
  params: { workspaceId: string; channelId: string; live: readonly EvolutionGroup[]; now?: Date },
): Promise<void> {
  try {
    const names = communityNames(params.live);
    const groups = params.live.filter((group) => !group.isCommunity);
    if (groups.length > 0) {
      const rows = groups.map((group) => ({
        workspace_id: params.workspaceId,
        channel_id: params.channelId,
        group_jid: group.jid,
        in_inbox: true,
        left_at: null,
        ...liveGroupColumns(group, group.parentJid ? (names.get(group.parentJid) ?? null) : null),
      }));
      // `defaultToNull: false`: lo que una fila no trae (por ejemplo `number_is_admin` desconocido) no se pisa.
      const { error } = await service.from("whatsapp_groups").upsert(rows, { onConflict: "channel_id,group_jid", defaultToNull: false });
      if (error) console.error("[grupos] no pude sumar los grupos del numero:", error.message);
    }
    const present = groups.map((group) => group.jid);
    let gone = service
      .from("whatsapp_groups")
      .update({ left_at: (params.now ?? new Date()).toISOString() })
      .eq("workspace_id", params.workspaceId)
      .eq("channel_id", params.channelId)
      .is("left_at", null);
    if (present.length > 0) gone = gone.not("group_jid", "in", `(${present.map((jid) => `"${jid}"`).join(",")})`);
    const { error: goneError } = await gone;
    if (goneError) console.error("[grupos] no pude marcar los grupos dejados:", goneError.message);
  } catch (err) {
    console.error("[grupos] no pude sincronizar los grupos:", err instanceof Error ? err.message : String(err));
  }
}
