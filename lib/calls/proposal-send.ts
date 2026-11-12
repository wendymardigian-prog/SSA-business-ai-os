// @plantilla-quitar(servicios)
/**
 * El mensaje que se aprobó de una propuesta (Servicios A4, F144; decisión 477). Solo servidor.
 *
 * Sale AL APROBARLO, de a uno, por las mismas piezas que la bandeja (`sendChannelMessage` + la fila del mensaje como
 * escrito por quien aprobó, `origin: "user"`), sin tocar la ruta de la bandeja. A un grupo, por `sendToGroup`. Sin cola.
 * Permisos: la conversación se lee con la SESIÓN (si no la ve, no existe) y hace falta poder responder en esa cuenta
 * (`canReplyChannel`); un grupo, `canWriteWhatsappGroup`. Un contacto «no contactar» no recibe nada.
 * El reintento reusa el mensaje fallido (`failed → pending`, como «Reintentar» en la bandeja): no duplica.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { canWriteWhatsappGroup, grantFor } from "@/lib/auth/channel-permissions";
import type { RolePermissions } from "@/lib/auth/permissions";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { messagePreview } from "@/lib/message-preview";
import { applyManualReply } from "@/lib/agent/manual-reply";
import { sendChannelMessage, type SendContext } from "@/lib/flow-engine/send";
import { sendErrorText } from "@/lib/inbox/send-failure";
import { sendToGroup } from "@/lib/whatsapp-groups/send";
import type { MessageDestination } from "./proposals-resolve";

type Db = SupabaseClient<Database>;

export type ProposalSendCtx = {
  supabase: Db;
  service: Db;
  workspaceId: string;
  userId: string;
  permissions: RolePermissions;
  isAdmin: boolean;
  contactId: string;
};

export async function sendProposalMessage(
  ctx: ProposalSendCtx,
  input: { destination: MessageDestination; text: string; retryOf: string | null },
): Promise<{ ok: true; id: string } | { ok: false; reason: string; messageId?: string | null }> {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "El mensaje está vacío." };

  if (input.destination.kind === "group") {
    const { data: group } = await ctx.service
      .from("whatsapp_groups")
      .select("id, workspace_id, channel_id, group_jid, in_inbox, left_at")
      .eq("id", input.destination.id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    const g = group as { id: string; workspace_id: string; channel_id: string; group_jid: string; in_inbox: boolean; left_at: string | null } | null;
    if (!g || g.left_at) return { ok: false, reason: "Ese grupo ya no está disponible." };
    if (!ctx.isAdmin && (!g.in_inbox || !canWriteWhatsappGroup(grantFor(ctx.permissions.channels, g.channel_id)))) {
      return { ok: false, reason: "No tenés permiso para escribir en ese grupo." };
    }
    const r = await sendToGroup(ctx.service, g, { text }, { userId: ctx.userId });
    if (!r.ok) return { ok: false, reason: r.error ?? "No se pudo mandar al grupo.", messageId: r.messageId ?? null };
    return { ok: true, id: r.messageId ?? `group-${Date.now()}` };
  }

  // El chat del contacto: la conversación con la sesión (la RLS decide si la ve).
  const { data: conversation } = await ctx.supabase
    .from("conversations")
    .select("id, workspace_id, contact_id, channel_id, late_conversation_id, channels(id, provider, late_account_id, is_active), contacts(do_not_contact)")
    .eq("id", input.destination.id)
    .maybeSingle();
  const conv = conversation as {
    id: string;
    workspace_id: string;
    contact_id: string;
    channel_id: string;
    late_conversation_id: string | null;
    channels: { id: string; provider: string; late_account_id: string; is_active: boolean } | null;
    contacts: { do_not_contact: boolean } | null;
  } | null;
  if (!conv || conv.workspace_id !== ctx.workspaceId) return { ok: false, reason: "No encontré esa conversación." };
  if (conv.contact_id !== ctx.contactId) return { ok: false, reason: "Esa conversación no es del contacto de la reunión." };
  if (!canReplyChannel(ctx.permissions, conv.channel_id)) return { ok: false, reason: "No tenés permiso para responder por esa cuenta." };
  if (conv.contacts?.do_not_contact) return { ok: false, reason: "El contacto está marcado «no contactar»." };
  if (!conv.channels || conv.channels.provider !== "evolution") return { ok: false, reason: "El mensaje para el cliente sale por WhatsApp." };

  if (input.retryOf) {
    const { data: claimed } = await ctx.service
      .from("messages")
      .update({ status: "pending", send_error: null })
      .eq("id", input.retryOf)
      .eq("conversation_id", conv.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (!claimed) return { ok: false, reason: "Ese mensaje ya se está reintentando o ya salió.", messageId: input.retryOf };
  }

  const context: SendContext = {
    workspaceId: conv.workspace_id,
    channelId: conv.channels.id,
    contactId: conv.contact_id,
    conversationId: conv.id,
    lateConversationId: conv.late_conversation_id ?? undefined,
    lateAccountId: conv.channels.late_account_id ?? undefined,
  };
  let outcome: Awaited<ReturnType<typeof sendChannelMessage>>;
  try {
    outcome = await sendChannelMessage(ctx.supabase, context, { text }, { secrets: ctx.service });
  } catch {
    outcome = { ok: false, failure: { kind: "unknown", message: "No se pudo enviar el mensaje.", hint: "Probá de nuevo en un momento.", retryable: true } };
  }
  const sendError = outcome.ok ? null : sendErrorText(outcome.failure);
  const now = new Date().toISOString();

  let messageId: string | null = input.retryOf;
  if (input.retryOf) {
    await ctx.service
      .from("messages")
      .update(outcome.ok ? { status: "sent" as const, send_error: null, platform_message_id: outcome.platformMessageId ?? null, sent_by_user_id: ctx.userId, created_at: now } : { status: "failed" as const, send_error: sendError })
      .eq("id", input.retryOf);
  } else {
    const { data: stored, error } = await ctx.supabase
      .from("messages")
      .insert({
        ...outboundMessageRow({ conversationId: conv.id, origin: "user", text, attachments: null, platformMessageId: outcome.platformMessageId ?? null, sentByUserId: ctx.userId, status: outcome.ok ? "sent" : "failed", createdAt: now }),
        send_error: sendError,
      })
      .select("id")
      .single();
    if (error) console.error("[propuestas] no pude guardar el mensaje:", error.message);
    messageId = (stored as { id: string } | null)?.id ?? null;
  }

  if (!outcome.ok) return { ok: false, reason: sendError ?? "No se pudo enviar el mensaje.", messageId };
  await ctx.supabase.from("conversations").update({ last_message_at: now, last_message_preview: messagePreview(text) }).eq("id", conv.id);
  await applyManualReply(ctx.supabase, { conversationId: conv.id, workspaceId: conv.workspace_id, userId: ctx.userId });
  return { ok: true, id: messageId ?? outcome.platformMessageId ?? `sent-${Date.now()}` };
}

export type DestinationOption = { kind: "conversation" | "group"; id: string; label: string };

/**
 * Los destinos posibles: las conversaciones de WhatsApp del contacto donde quien aprueba puede responder (la última
 * primero) y los grupos de los números a los que tiene acceso para escribir.
 */
export async function proposalDestinations(ctx: Omit<ProposalSendCtx, "userId">): Promise<DestinationOption[]> {
  const out: DestinationOption[] = [];
  const { data: convs } = await ctx.supabase
    .from("conversations")
    .select("id, channel_id, last_message_at, channels(provider, display_name)")
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_id", ctx.contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(20);
  for (const c of (convs ?? []) as Array<{ id: string; channel_id: string; channels: { provider: string; display_name: string | null } | null }>) {
    if (c.channels?.provider !== "evolution") continue;
    if (!canReplyChannel(ctx.permissions, c.channel_id)) continue;
    out.push({ kind: "conversation", id: c.id, label: `Chat de WhatsApp${c.channels.display_name ? ` (${c.channels.display_name})` : ""}` });
  }
  const { data: groups } = await ctx.service
    .from("whatsapp_groups")
    .select("id, channel_id, subject, in_inbox, left_at")
    .eq("workspace_id", ctx.workspaceId)
    .is("left_at", null)
    .order("subject")
    .limit(200);
  for (const g of (groups ?? []) as Array<{ id: string; channel_id: string; subject: string | null; in_inbox: boolean }>) {
    if (!ctx.isAdmin && (!g.in_inbox || !canWriteWhatsappGroup(grantFor(ctx.permissions.channels, g.channel_id)))) continue;
    out.push({ kind: "group", id: g.id, label: `Grupo: ${g.subject ?? "sin nombre"}` });
  }
  return out;
}
