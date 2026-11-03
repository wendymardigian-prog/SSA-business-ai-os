/**
 * Lo que pasa en un grupo de WhatsApp activado, guardado. Solo servidor (cliente de servicio).
 *
 * Lo llama el receptor de Evolution DESPUES de responder 200 (en `after()`), y solo para grupos que el negocio
 * activo en Ajustes (una fila en `whatsapp_groups`): de un grupo no activado no se guarda nada, igual que antes.
 *
 *   - Alguien entra: se anota el miembro y, si el grupo guarda contactos, se crea o vincula el contacto con su
 *     toque. Con contacto, se emite `whatsapp_group_joined`.
 *   - Un mensaje: se guarda en el hilo del grupo (texto, adjuntos, encuesta). No pasa por el agente, ni por los
 *     flujos de mensajes, ni por «Esperando respuesta»: un grupo no es una conversacion con un lead.
 *   - Una reaccion o un voto: se guarda (una por persona y mensaje, la ultima gana) y, si es de una persona (no del
 *     negocio) y hay contacto, se emite el evento.
 *
 * NADA de lo de aca lanza: el webhook ya respondio, y un grupo no puede tumbar a nadie.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { WhatsappSender } from "@/lib/whatsapp-sender";
import { extractText, describeAttachment, messageTimestamp } from "@/lib/evolution-message";
import { describeWhatsappMessage, evolutionMediaFetcher } from "@/lib/evolution-media";
import { hasDownloadableMedia, toAttachmentsColumn } from "@/lib/messages/attachments";
import { previewForMessage } from "@/lib/message-preview";
import { downloadAttachments, chatMediaEnabled } from "@/lib/inbound-media";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { parseBaileysReaction } from "@/lib/messages/reactions-inbound";
import { parseBaileysPollVote } from "@/lib/messages/poll-votes";
import {
  groupMessageSender,
  parsePollCreation,
  type GroupMessageKey,
  type GroupParticipantsEvent,
} from "./parse";
import { resolveGroupContact, type GroupChannel } from "./contacts";
import { emitGroupEvent } from "./automation/emit";
import { joinedPayload, pollVotePayload, reactionPayload, type GroupMessageRef } from "./automation/payload";
import { groupMediaFolder, isOwnParticipant, participantKeyOf } from "./rules";

type Db = SupabaseClient<Database>;

export interface InboundGroupChannel extends GroupChannel {
  evolution_instance: string | null;
}

type GroupRow = Database["public"]["Tables"]["whatsapp_groups"]["Row"];
type GroupMessageRow = Database["public"]["Tables"]["whatsapp_group_messages"]["Row"];

/** El grupo activado de ese numero, o null (no activado: no se guarda nada). */
export async function loadActiveGroup(db: Db, channelId: string, groupJid: string): Promise<GroupRow | null> {
  try {
    const { data } = await db
      .from("whatsapp_groups")
      .select("*")
      .eq("channel_id", channelId)
      .eq("group_jid", groupJid)
      .is("left_at", null)
      .maybeSingle();
    const group = data as GroupRow | null;
    if (!group || (!group.in_inbox && !group.save_contacts)) return null;
    return group;
  } catch (err) {
    console.error("[grupos] no pude leer el grupo:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Entradas y salidas ────────────────────────────────────────────────────────

export async function handleGroupParticipants(
  db: Db,
  channel: InboundGroupChannel,
  event: GroupParticipantsEvent,
  now: Date = new Date(),
): Promise<{ joined: number; emitted: number }> {
  const result = { joined: 0, emitted: 0 };
  const group = await loadActiveGroup(db, channel.id, event.groupJid);
  if (!group) return result;
  const at = now.toISOString();

  for (const participant of event.participants) {
    if (isOwnParticipant(channel, participant)) continue;
    try {
      if (event.action === "remove") {
        await db
          .from("whatsapp_group_members")
          .update({ left_at: at })
          .eq("group_id", group.id)
          .in("participant_id", participantKeyOf(participant));
        continue;
      }
      if (event.action === "promote" || event.action === "demote") {
        await db
          .from("whatsapp_group_members")
          .update({ is_admin: event.action === "promote" })
          .eq("group_id", group.id)
          .in("participant_id", participantKeyOf(participant));
        continue;
      }

      // add: el miembro vuelve a estar (aunque haya salido antes).
      await db.from("whatsapp_group_members").upsert(
        {
          workspace_id: group.workspace_id,
          group_id: group.id,
          participant_id: participant.id,
          phone: participant.phone,
          lid: participant.lid,
          source: "join",
          joined_at: at,
          left_at: null,
        },
        { onConflict: "group_id,participant_id" },
      );
      result.joined++;

      const contactId = await resolveGroupContact(db, { channel, group, sender: participant, name: null, event: "join", at });
      if (!contactId) continue;
      const emitted = await emitGroupEvent(db, {
        workspaceId: group.workspace_id,
        contactId,
        type: "whatsapp_group_joined",
        payload: joinedPayload(group, participant.id),
      });
      if (emitted) result.emitted++;
    } catch (err) {
      console.error("[grupos] no pude procesar un miembro:", err instanceof Error ? err.message : err);
    }
  }
  return result;
}

// ── Mensajes, reacciones y votos ──────────────────────────────────────────────

export interface GroupMessageData {
  key?: GroupMessageKey & { fromMe?: boolean; id?: string | null };
  pushName?: string | null;
  message?: Record<string, unknown> | null;
  messageType?: string | null;
  messageTimestamp?: number | string | null;
}

export type GroupMessageOutcome = "ignored" | "stored" | "duplicate" | "reaction" | "vote";

export async function handleGroupMessage(
  db: Db,
  channel: InboundGroupChannel,
  group: GroupRow,
  data: GroupMessageData,
): Promise<GroupMessageOutcome> {
  try {
    const fromMe = data.key?.fromMe === true;
    const sender = fromMe ? null : groupMessageSender(data.key);
    // Una persona que no se puede identificar no puede reaccionar, votar ni escribir algo atribuible.
    if (!fromMe && !sender) return "ignored";
    const at = messageTimestamp(data.messageTimestamp ?? undefined);

    const reaction = parseBaileysReaction(data.message);
    if (reaction) {
      await handleGroupReaction(db, channel, group, { sender, fromMe, targetId: reaction.targetId, emoji: reaction.emoji, name: data.pushName ?? null, at });
      return "reaction";
    }

    const vote = parseBaileysPollVote(data.message);
    if (vote) {
      if (vote.decrypted && vote.pollMessageId) {
        await handleGroupPollVote(db, channel, group, { sender, fromMe, pollMessageId: vote.pollMessageId, selected: vote.selectedOptions, name: data.pushName ?? null, at });
      }
      return "vote";
    }

    return await storeGroupMessage(db, channel, group, data, sender, fromMe, at);
  } catch (err) {
    console.error("[grupos] no pude procesar el mensaje del grupo:", err instanceof Error ? err.message : err);
    return "ignored";
  }
}

async function storeGroupMessage(
  db: Db,
  channel: InboundGroupChannel,
  group: GroupRow,
  data: GroupMessageData,
  sender: WhatsappSender | null,
  fromMe: boolean,
  at: string,
): Promise<GroupMessageOutcome> {
  const text = extractText(data.message ?? undefined);
  const attachments = describeWhatsappMessage(data.message ?? null);
  const poll = parsePollCreation(data.message);
  // Una encuesta se guarda como encuesta (con sus opciones), no como un adjunto «📊 Encuesta» sin datos.
  const items = poll ? attachments.filter((item) => item.kind !== "poll") : attachments;
  const attachmentsColumn = toAttachmentsColumn(items);
  const preview = poll
    ? `📊 ${poll.name}`
    : previewForMessage({ text, attachments: attachmentsColumn }) || describeAttachment(data.messageType ?? undefined) || "";
  if (!text && items.length === 0 && !poll) return "ignored";

  const { data: inserted, error } = await db
    .from("whatsapp_group_messages")
    .upsert(
      {
        workspace_id: group.workspace_id,
        group_id: group.id,
        platform_message_id: data.key?.id ?? null,
        direction: fromMe ? "outbound" : "inbound",
        sender_participant_id: sender?.id ?? null,
        sender_name: fromMe ? null : data.pushName?.trim() || null,
        text,
        attachments: attachmentsColumn as Json,
        poll: poll as unknown as Json,
        origin: "external",
        status: "sent",
        created_at: at,
      },
      // El eco de lo que mandamos desde la app ya esta guardado con este id: no se pisa.
      { onConflict: "group_id,platform_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[grupos] no pude guardar el mensaje:", error.message);
    return "ignored";
  }
  if (!inserted) return "duplicate";

  // El hilo del grupo en la lista: el ultimo mensaje y, si es de otra persona, un no leido mas.
  await db
    .from("whatsapp_groups")
    .update({
      last_message_at: at,
      last_message_preview: sender && data.pushName ? `${data.pushName.trim()}: ${preview}` : preview,
      ...(fromMe ? {} : { unread_count: group.unread_count + 1 }),
    })
    .eq("id", group.id);

  // Quien escribe es miembro (si no lo teniamos por una entrada o una importacion).
  if (sender) {
    await db.from("whatsapp_group_members").upsert(
      {
        workspace_id: group.workspace_id,
        group_id: group.id,
        participant_id: sender.id,
        phone: sender.phone,
        lid: sender.lid,
        display_name: data.pushName?.trim() || null,
        source: "activity",
      },
      { onConflict: "group_id,participant_id", ignoreDuplicates: true },
    );
  }

  // La media se pide ahora (WhatsApp la borra de su servidor). Sin transcribir: en un grupo no hay agente.
  if (hasDownloadableMedia(items)) {
    await storeGroupMedia(db, channel, group, inserted.id, data.message ?? null, items);
  }
  return "stored";
}

async function storeGroupMedia(
  db: Db,
  channel: InboundGroupChannel,
  group: GroupRow,
  messageId: string,
  rawMessage: Record<string, unknown> | null,
  items: ReturnType<typeof describeWhatsappMessage>,
): Promise<void> {
  try {
    const config = await getEvolutionConfig(db, group.workspace_id);
    if (!config || !channel.evolution_instance) return;
    const enabled = await chatMediaEnabled(db, group.workspace_id);
    const result = enabled
      ? await downloadAttachments({
          supabase: db,
          workspaceId: group.workspace_id,
          conversationId: groupMediaFolder(group.id),
          messageId,
          items,
          fetcher: evolutionMediaFetcher({ config, instance: channel.evolution_instance, rawMessage }),
        })
      : { items: items.map((item) => (item.status === "pending" ? { ...item, status: "none" as const } : item)) };
    await db
      .from("whatsapp_group_messages")
      .update({ attachments: toAttachmentsColumn(result.items) as Json })
      .eq("id", messageId);
  } catch (err) {
    console.error("[grupos] no pude guardar la media:", err instanceof Error ? err.message : err);
  }
}

async function findGroupMessage(db: Db, groupId: string, platformMessageId: string): Promise<GroupMessageRow | null> {
  const { data } = await db
    .from("whatsapp_group_messages")
    .select("*")
    .eq("group_id", groupId)
    .eq("platform_message_id", platformMessageId)
    .maybeSingle();
  return (data as GroupMessageRow | null) ?? null;
}

function messageRef(row: GroupMessageRow): GroupMessageRef {
  return {
    id: row.id,
    text: row.text ?? (row.poll && typeof row.poll === "object" ? String((row.poll as { name?: unknown }).name ?? "") : null),
    direction: row.direction,
    sent_by_flow_id: row.sent_by_flow_id,
    sent_by_node_id: row.sent_by_node_id,
  };
}

/** La clave de quien reacciona o vota: su identidad, o "me" si fue el negocio. */
const BUSINESS_PARTICIPANT = "me";

async function handleGroupReaction(
  db: Db,
  channel: InboundGroupChannel,
  group: GroupRow,
  args: { sender: WhatsappSender | null; fromMe: boolean; targetId: string; emoji: string; name: string | null; at: string },
): Promise<void> {
  const message = await findGroupMessage(db, group.id, args.targetId);
  if (!message) return;
  const participantId = args.fromMe ? BUSINESS_PARTICIPANT : args.sender!.id;

  if (!args.emoji) {
    await db
      .from("whatsapp_group_reactions")
      .update({ removed_at: args.at })
      .eq("message_id", message.id)
      .eq("participant_id", participantId);
    return;
  }

  await db.from("whatsapp_group_reactions").upsert(
    {
      workspace_id: group.workspace_id,
      group_id: group.id,
      message_id: message.id,
      participant_id: participantId,
      from_me: args.fromMe,
      emoji: args.emoji,
      removed_at: null,
    },
    { onConflict: "message_id,participant_id" },
  );

  if (args.fromMe || !args.sender) return;
  const contactId = await resolveGroupContact(db, { channel, group, sender: args.sender, name: args.name, event: "activity", at: args.at });
  if (!contactId) return;
  await emitGroupEvent(db, {
    workspaceId: group.workspace_id,
    contactId,
    type: "whatsapp_group_reaction",
    payload: reactionPayload(group, args.sender.id, messageRef(message), args.emoji),
  });
}

async function handleGroupPollVote(
  db: Db,
  channel: InboundGroupChannel,
  group: GroupRow,
  args: { sender: WhatsappSender | null; fromMe: boolean; pollMessageId: string; selected: string[]; name: string | null; at: string },
): Promise<void> {
  const message = await findGroupMessage(db, group.id, args.pollMessageId);
  const poll = message?.poll && typeof message.poll === "object" ? (message.poll as { name?: unknown }) : null;
  if (!message || !poll) return;
  const participantId = args.fromMe ? BUSINESS_PARTICIPANT : args.sender!.id;

  await db.from("whatsapp_poll_votes").upsert(
    {
      workspace_id: group.workspace_id,
      group_id: group.id,
      message_id: message.id,
      participant_id: participantId,
      selected_options: args.selected,
      voted_at: args.at,
    },
    { onConflict: "message_id,participant_id" },
  );

  if (args.fromMe || !args.sender || args.selected.length === 0) return;
  const contactId = await resolveGroupContact(db, { channel, group, sender: args.sender, name: args.name, event: "activity", at: args.at });
  if (!contactId) return;
  await emitGroupEvent(db, {
    workspaceId: group.workspace_id,
    contactId,
    type: "whatsapp_group_poll_vote",
    payload: pollVotePayload(group, args.sender.id, messageRef(message), { name: String(poll.name ?? "") }, args.selected),
  });
}
