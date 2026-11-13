"use server";

import { getAnyPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { accountLabel } from "@/lib/inbox/accounts";
import { ensureWhatsappChat } from "@/lib/inbox/start-whatsapp";

/**
 * El botón del teléfono en el panel de una reunión, cuando todavía no hay chat
 * de WhatsApp con ese contacto: comprueba en Evolution que el número tiene
 * WhatsApp, abre la conversación (vacía, no manda nada) y devuelve su id para
 * ir a la bandeja.
 *
 * Mismos permisos que ver el detalle (`scheduling.use` o `bookings.view`); la
 * reunión se lee con la sesión, así que la RLS decide si la ve. El número del
 * negocio tiene que ser uno donde su rol pueda responder. Con más de uno y sin
 * `channelId`, devuelve la lista para que la pantalla pregunte desde cuál.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartBookingWhatsappResult =
  | { ok: true; conversationId: string }
  | { ok: true; pickChannel: Array<{ id: string; label: string }> }
  | { ok: false; error: string };

export async function startBookingWhatsappChat(input: { bookingId: string; channelId?: string | null }): Promise<StartBookingWhatsappResult> {
  if (!UUID.test(input?.bookingId ?? "") || (input.channelId != null && !UUID.test(input.channelId))) return { ok: false, error: "Pedido inválido." };
  const ctx = await getAnyPermissionAction(["scheduling.use", "bookings.view"]);
  if (!ctx) return { ok: false, error: "No tenés permiso para ver esta agenda." };

  const { data: booking } = await ctx.supabase
    .from("bookings")
    .select("id, contact_id, booker_phone")
    .eq("id", input.bookingId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "No encontré esa agenda." };

  const service = await createServiceClient();
  const [{ data: channels }, { data: contact }] = await Promise.all([
    service
      .from("channels")
      .select("id, platform, provider, display_name, username, evolution_instance")
      .eq("workspace_id", ctx.workspace.id)
      .eq("platform", "whatsapp")
      .eq("provider", "evolution")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    service.from("contacts").select("id, phone, deleted_at").eq("id", booking.contact_id).eq("workspace_id", ctx.workspace.id).maybeSingle(),
  ]);
  if (!contact || contact.deleted_at) return { ok: false, error: "No encontré el contacto de esta agenda." };

  const usable = (channels ?? []).filter((c) => canReplyChannel(ctx.permissions, c.id));
  if (usable.length === 0) {
    return { ok: false, error: (channels ?? []).length === 0 ? "No hay un WhatsApp conectado." : "Tu rol no puede escribir por WhatsApp." };
  }

  let channel = input.channelId ? usable.find((c) => c.id === input.channelId) : usable.length === 1 ? usable[0] : undefined;
  if (input.channelId && !channel) return { ok: false, error: "No podés escribir desde ese número." };
  if (!channel) {
    // Si ya hay chat en uno de sus números, se usa ese: no hace falta preguntar.
    const { data: existing } = await service
      .from("conversations")
      .select("channel_id")
      .eq("contact_id", contact.id)
      .in(
        "channel_id",
        usable.map((c) => c.id),
      )
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    channel = existing ? usable.find((c) => c.id === existing.channel_id) : undefined;
    if (!channel) return { ok: true, pickChannel: usable.map((c) => ({ id: c.id, label: accountLabel(c) })) };
  }

  const { data: conv } = await service.from("conversations").select("id, deleted_at").eq("channel_id", channel.id).eq("contact_id", contact.id).maybeSingle();
  if (conv?.deleted_at) return { ok: false, error: "El chat con este contacto en ese número se eliminó de la bandeja." };
  if (conv) return { ok: true, conversationId: conv.id };

  const result = await ensureWhatsappChat(service, {
    workspaceId: ctx.workspace.id,
    channel: { id: channel.id, evolutionInstance: channel.evolution_instance },
    contactId: contact.id,
    phone: booking.booker_phone || contact.phone,
    preview: "",
  });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, conversationId: result.conversationId };
}
