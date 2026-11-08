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
 * Escribe en las filas guardadas de un numero lo que vino de `fetchAllGroups` (la lista entera, con las
 * comunidades). Una fila por grupo guardado que siga entre los del numero.
 */
export async function refreshSavedGroupsFromLive(
  service: Service,
  params: { workspaceId: string; channelId: string; live: readonly EvolutionGroup[]; savedJids: readonly string[] },
): Promise<void> {
  const names = communityNames(params.live);
  const saved = new Set(params.savedJids);
  const updates = params.live
    .filter((group) => !group.isCommunity && saved.has(group.jid))
    .map(async (group) => {
      const { error } = await service
        .from("whatsapp_groups")
        .update(liveGroupColumns(group, group.parentJid ? (names.get(group.parentJid) ?? null) : null))
        .eq("workspace_id", params.workspaceId)
        .eq("channel_id", params.channelId)
        .eq("group_jid", group.jid);
      if (error) console.error("[grupos] no pude actualizar un grupo:", error.message);
    });
  await Promise.all(updates);
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
