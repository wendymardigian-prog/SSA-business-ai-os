/**
 * «Importar miembros»: trae como contactos a los que YA estan en un grupo activado. Solo servidor.
 *
 * Corre en la cola (`whatsapp_group_import`), por partes de `IMPORT_BATCH`: un grupo grande no entra en una sola
 * peticion. Cada miembro se crea o se vincula por la regla unica, con el toque «WhatsApp · grupo de WhatsApp ·
 * <grupo>» (`group_event: import`, una vez por grupo). **No dispara automatizaciones**: no es alguien que entro,
 * es alguien que ya estaba.
 *
 * No lanza por un fallo de Evolution: reagenda a 1, 5 y 15 minutos (la cola reintentaria a los 10 segundos
 * encima). Al terminar deja una entrada en el historial con cuantos sumo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { fetchGroupParticipants, type EvolutionGroupParticipant } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { scheduleJob } from "@/lib/scheduler";
import { logAudit } from "@/lib/audit";
import { participantIdentity } from "./parse";
import { resolveGroupContact } from "./contacts";
import { isOwnParticipant } from "./rules";
import { IMPORT_BATCH, importRetryDelayMinutes } from "./settings";

type Db = SupabaseClient<Database>;

export const GROUP_IMPORT_JOB = "whatsapp_group_import";

export interface GroupImportPayload {
  workspaceId: string;
  groupId: string;
  /** Quien la pidio (para el historial). */
  requestedBy: string | null;
  offset?: number;
  attempt?: number;
  /** Lo sumado en las vueltas anteriores. */
  imported?: number;
}

export function groupImportDedupeKey(groupId: string): string {
  return `${GROUP_IMPORT_JOB}:${groupId}`;
}

export type GroupImportOutcome = "done" | "next" | "retry" | "gave_up" | "skipped";

export interface GroupImportDeps {
  fetchParticipants?: typeof fetchGroupParticipants;
  schedule?: typeof scheduleJob;
  now?: () => Date;
}

export async function runGroupImport(db: Db, payload: GroupImportPayload, deps: GroupImportDeps = {}): Promise<GroupImportOutcome> {
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? scheduleJob;
  const fetchParticipants = deps.fetchParticipants ?? fetchGroupParticipants;
  const offset = payload.offset ?? 0;
  const attempt = payload.attempt ?? 1;

  const { data: group } = await db
    .from("whatsapp_groups")
    .select("*")
    .eq("id", payload.groupId)
    .eq("workspace_id", payload.workspaceId)
    .maybeSingle();
  if (!group || group.left_at) return "skipped";
  const { data: channel } = await db
    .from("channels")
    .select("id, workspace_id, late_account_id, platform, username, display_name, evolution_instance")
    .eq("id", group.channel_id)
    .maybeSingle();
  if (!channel?.evolution_instance) return "skipped";

  let participants: EvolutionGroupParticipant[];
  try {
    const config = await getEvolutionConfig(db, payload.workspaceId);
    if (!config) return "skipped";
    participants = await fetchParticipants(config, channel.evolution_instance, group.group_jid);
  } catch (err) {
    const minutes = importRetryDelayMinutes(attempt);
    console.error("[grupos] no pude leer los miembros del grupo:", err instanceof Error ? err.message : String(err));
    if (minutes === null) return "gave_up";
    try {
      await schedule(db, GROUP_IMPORT_JOB, { ...payload, attempt: attempt + 1 } as unknown as Record<string, unknown>, new Date(now().getTime() + minutes * 60_000), groupImportDedupeKey(payload.groupId));
      return "retry";
    } catch {
      return "gave_up";
    }
  }

  const batch = participants.slice(offset, offset + IMPORT_BATCH);
  let imported = payload.imported ?? 0;
  const at = now().toISOString();
  for (const raw of batch) {
    const sender = participantIdentity(raw);
    if (!sender || isOwnParticipant(channel, sender)) continue;
    try {
      await db.from("whatsapp_group_members").upsert(
        {
          workspace_id: group.workspace_id,
          group_id: group.id,
          participant_id: sender.id,
          phone: sender.phone,
          lid: sender.lid,
          display_name: raw.name,
          is_admin: raw.admin,
          source: "import",
          left_at: null,
        },
        { onConflict: "group_id,participant_id", ignoreDuplicates: true },
      );
      // Importar es crear contactos, aunque el grupo no los guarde solo al entrar.
      const contactId = await resolveGroupContact(db, {
        channel,
        group: { ...group, save_contacts: true },
        sender,
        name: raw.name,
        event: "import",
        at,
      });
      if (contactId) imported++;
    } catch (err) {
      console.error("[grupos] no pude importar un miembro:", err instanceof Error ? err.message : String(err));
    }
  }

  const nextOffset = offset + IMPORT_BATCH;
  if (nextOffset < participants.length) {
    try {
      await schedule(db, GROUP_IMPORT_JOB, { ...payload, offset: nextOffset, attempt: 1, imported } as unknown as Record<string, unknown>, now(), groupImportDedupeKey(payload.groupId));
      return "next";
    } catch (err) {
      console.error("[grupos] no pude seguir la importacion:", err instanceof Error ? err.message : String(err));
      return "gave_up";
    }
  }

  await logAudit({
    supabase: db,
    workspaceId: group.workspace_id,
    entityType: "channel",
    entityId: group.channel_id,
    action: "update",
    changes: {},
    metadata: { section: "whatsapp_groups", event: "import_members", group_id: group.id, members: participants.length, imported },
    performedBy: payload.requestedBy,
  });
  return "done";
}
