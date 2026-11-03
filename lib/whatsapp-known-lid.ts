/**
 * La identidad de WhatsApp de alguien que ya entro SOLO con su @lid.
 *
 * Si la persona ya entro antes SOLO con su @lid (sin telefono) y ahora llega con
 * los dos, se sigue usando el @lid como identidad: asi el mensaje cae en el mismo
 * contacto y la misma conversacion, y el telefono se le suma a la ficha
 * (find_or_link_contact completa los datos de un remitente conocido). Si no, el
 * telefono, como siempre. Nunca lanza: ante un error, la identidad de siempre.
 *
 * La usan el receptor de Evolution (chats privados y llamadas) y los grupos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsappSender } from "@/lib/whatsapp-sender";

export async function withKnownLid(
  supabase: SupabaseClient,
  channel: { id: string },
  sender: WhatsappSender,
): Promise<WhatsappSender> {
  if (!sender.phone || !sender.lid || sender.id === sender.lid) return sender;
  try {
    const { data } = await supabase
      .from("contact_channels")
      .select("contact_id")
      .eq("channel_id", channel.id)
      .eq("platform_sender_id", sender.lid)
      .maybeSingle();
    return data ? { ...sender, id: sender.lid } : sender;
  } catch (err) {
    console.error("[whatsapp] no pude buscar el @lid conocido:", err instanceof Error ? err.message : err);
    return sender;
  }
}
