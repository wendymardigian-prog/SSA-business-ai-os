/**
 * El contacto detras de alguien de un grupo de WhatsApp. Solo servidor (cliente de servicio).
 *
 * La identidad es la de siempre (telefono o @lid, `contact_channels.platform_sender_id`), asi el que entro por un
 * grupo y despues escribe por privado es un solo contacto.
 *
 *   - El grupo GUARDA contactos (`save_contacts`): se crea o se vincula por la regla unica (`find_or_link_contact`,
 *     sin conversacion) y se anota UNA vez por grupo el toque «WhatsApp · grupo de WhatsApp · <grupo>».
 *   - No guarda: solo se busca uno que ya exista; si no hay, null (no se crea nadie).
 *
 * Nunca lanza: un fallo deja null y una linea en el log, sin datos de la persona.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { WhatsappSender } from "@/lib/whatsapp-sender";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { recordTouch } from "@/lib/contacts/touch";
import { touchAccountOf } from "@/lib/inbox/accounts";
import { withKnownLid } from "@/lib/whatsapp-known-lid";

type Db = SupabaseClient<Database>;

/** El nombre de un contacto de WhatsApp del que no sabemos ni el nombre ni el numero. */
const UNKNOWN_WHATSAPP_NAME = "Contacto de WhatsApp";

export type GroupContactEvent = "join" | "import" | "activity";

export interface GroupChannel {
  id: string;
  workspace_id: string;
  late_account_id: string;
  platform: string;
  username?: string | null;
  display_name?: string | null;
}

export interface GroupForContact {
  id: string;
  group_jid: string;
  subject: string;
  save_contacts: boolean;
}

/** La clave del toque de grupo: una vez por persona y grupo. */
export function groupTouchKey(groupId: string, contactId: string): string {
  return `wa-group:${groupId}:${contactId}`;
}

/** Un contacto que ya existe con esa identidad en el canal, o null. */
export async function findGroupContact(db: Db, channel: { id: string }, sender: WhatsappSender): Promise<string | null> {
  try {
    const ids = Array.from(new Set([sender.id, sender.lid, sender.phone].filter((v): v is string => !!v)));
    const { data } = await db
      .from("contact_channels")
      .select("contact_id, platform_sender_id")
      .eq("channel_id", channel.id)
      .in("platform_sender_id", ids);
    const rows = (data ?? []) as Array<{ contact_id: string; platform_sender_id: string }>;
    // La identidad principal primero.
    const best = rows.find((r) => r.platform_sender_id === sender.id) ?? rows[0];
    return best?.contact_id ?? null;
  } catch (err) {
    console.error("[grupos] no pude buscar el contacto:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * El contacto de un participante: lo crea (y anota el toque) solo si el grupo guarda contactos. `name` es el
 * nombre que mostro WhatsApp (pushName), si lo hubo.
 */
export async function resolveGroupContact(
  db: Db,
  args: {
    channel: GroupChannel;
    group: GroupForContact;
    sender: WhatsappSender;
    name: string | null;
    event: GroupContactEvent;
    at: string;
  },
): Promise<string | null> {
  const { channel, group } = args;
  if (!group.save_contacts) return findGroupContact(db, channel, args.sender);

  try {
    const sender = await withKnownLid(db, channel, args.sender);
    const contact = await upsertContactForSender({
      supabase: db,
      channel,
      senderId: sender.id,
      senderName: args.name || sender.phone || UNKNOWN_WHATSAPP_NAME,
      senderUsername: sender.phone,
      senderPicture: null,
      senderPhone: sender.phone,
      interactionAt: args.at,
      // Entrar a un grupo no es escribirle al negocio: no se sella la ultima interaccion de un contacto existente.
      stampExisting: false,
    });
    if (!contact) return null;

    const account = touchAccountOf(channel);
    await recordTouch(db, {
      workspaceId: channel.workspace_id,
      contactId: contact.contactId,
      touch: {
        occurredAt: args.at,
        source: "whatsapp",
        medium: "whatsapp_group",
        content: group.subject,
        origin: "whatsapp_group",
        dedupeKey: groupTouchKey(group.id, contact.contactId),
        raw: { group_jid: group.group_jid, group_event: args.event, account_id: account.id, account_label: account.label },
      },
    });
    return contact.contactId;
  } catch (err) {
    console.error("[grupos] no pude resolver el contacto del grupo:", err instanceof Error ? err.message : err);
    return null;
  }
}
