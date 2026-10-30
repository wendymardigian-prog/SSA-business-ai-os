/**
 * Lee el historial que el Evolution del cliente tiene guardado y lo resume (solo
 * lectura). No le pide nada a WhatsApp: consulta la base del propio Evolution, asi
 * que no hay riesgo de bloqueo del numero. No escribe nada en la nuestra.
 *
 * Quien llama ya chequeo el permiso (`channels.manage`) y pasa el workspace de la
 * sesion: un canal de otro negocio no se encuentra. Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { EvolutionError, findStoredChats, findStoredMessagesPage, type EvolutionConfig } from "@/lib/evolution-client";
import { peopleSenderIds, summarizeHistory, whatsappTimestampToIso, type HistoryReview } from "./review";

type Db = SupabaseClient<Database>;

/** Tope de chats que se leen en una revision: alcanza para decidir, y la consulta de Evolution no tiene limite propio. */
export const REVIEW_CHAT_LIMIT = 5000;
const KNOWN_CHUNK = 300;

export type ReviewResult = { ok: true; review: HistoryReview } | { ok: false; error: string };

export interface ReviewDeps {
  getConfig?: (service: Db, workspaceId: string) => Promise<EvolutionConfig | null>;
  findChats?: typeof findStoredChats;
  findMessagesPage?: typeof findStoredMessagesPage;
}

export async function runHistoryReview(
  service: Db,
  target: { workspaceId: string; channelId: string },
  deps: ReviewDeps = {},
): Promise<ReviewResult> {
  const { data: channel, error: channelError } = await service
    .from("channels")
    .select("id, workspace_id, provider, evolution_instance, created_at")
    .eq("id", target.channelId)
    .eq("workspace_id", target.workspaceId)
    .maybeSingle();
  if (channelError) return { ok: false, error: "No pude leer el canal. Probá de nuevo en un rato." };
  if (!channel) return { ok: false, error: "No encontré ese canal." };
  if (channel.provider !== "evolution" || !channel.evolution_instance) {
    return { ok: false, error: "Este canal no es un WhatsApp conectado por QR." };
  }

  const config = await (deps.getConfig ?? getEvolutionConfig)(service, channel.workspace_id);
  if (!config) return { ok: false, error: "Falta la configuración de Evolution en Integraciones." };

  const instance = channel.evolution_instance;
  try {
    const chats = await (deps.findChats ?? findStoredChats)(config, instance, REVIEW_CHAT_LIMIT);

    const ids = peopleSenderIds(chats);
    const knownSenderIds = new Set<string>();
    for (let i = 0; i < ids.length; i += KNOWN_CHUNK) {
      const { data, error } = await service
        .from("contact_channels")
        .select("platform_sender_id")
        .eq("channel_id", channel.id)
        .in("platform_sender_id", ids.slice(i, i + KNOWN_CHUNK));
      if (error) return { ok: false, error: "No pude comparar con la bandeja. Probá de nuevo en un rato." };
      for (const row of data ?? []) knownSenderIds.add(row.platform_sender_id);
    }

    const findPage = deps.findMessagesPage ?? findStoredMessagesPage;
    const newest = await findPage(config, instance, 1, 1);
    const oldest = newest.total > 1 ? await findPage(config, instance, newest.total, 1) : newest;

    return {
      ok: true,
      review: summarizeHistory({
        chats,
        take: REVIEW_CHAT_LIMIT,
        knownSenderIds,
        totalMessages: newest.total,
        newestMessageAt: whatsappTimestampToIso(newest.records[0]?.messageTimestamp),
        oldestMessageAt: whatsappTimestampToIso(oldest.records[0]?.messageTimestamp),
        connectedAt: channel.created_at,
      }),
    };
  } catch (err) {
    const status = err instanceof EvolutionError ? err.status : undefined;
    console.error("[whatsapp-history] la revision fallo:", err instanceof Error ? err.message : err);
    if (status === 401 || status === 403) {
      return { ok: false, error: "Evolution rechazó la clave. Revisala en Integraciones." };
    }
    if (status === 404) {
      return { ok: false, error: "Evolution no encontró este número. Revisá que siga conectado." };
    }
    return { ok: false, error: "Evolution no respondió. Probá de nuevo en un rato." };
  }
}
