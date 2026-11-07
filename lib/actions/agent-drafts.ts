"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { getMemberAction } from "@/lib/auth/guards";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { approveDraft, discardDraft, regenerateDraft, type DraftActionResult } from "@/lib/agent/drafts/actions";
import { requestSuggestion } from "@/lib/agent/drafts/suggest";
import { loadLastDiscardedDraft, loadLastExpiredDraft, loadLiveDraft, type DraftQueueRow } from "@/lib/agent/drafts/queue-query";
import { loadPendingDraftCounts, type PendingDraftCounts } from "@/lib/agent/drafts/pending-count";

/**
 * Las cuatro decisiones sobre un borrador, desde la cola o desde la
 * conversacion (Bloque 2c). La logica vive en lib/agent/drafts/actions.ts;
 * aca se resuelve la sesion y se revalida.
 *
 * Aprobar es operar, no configurar: Owner, Admin y un Member en las
 * conversaciones de su scope. La RLS es la que decide, no este archivo.
 */

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const NO_REPLY: DraftActionResult = { ok: false, code: "unknown", error: "Tu rol no puede responder por esta cuenta." };

/**
 * Mandar, descartar o regenerar un borrador es operar la conversacion, asi que pide "puede responder" en
 * la CUENTA de ese borrador (00249). La RLS sigue acotando cuales borradores se ven.
 */
async function canReplyToDraft(supabase: Awaited<ReturnType<typeof createClient>>, draftId: string): Promise<boolean> {
  const access = await getMemberAction();
  if (!access) return false;
  const { data } = await supabase.from("agent_drafts").select("channel_id").eq("id", draftId).maybeSingle();
  return canReplyChannel(access.permissions, (data as { channel_id?: string | null } | null)?.channel_id ?? null);
}

const SESSION_EXPIRED: DraftActionResult = { ok: false, code: "unknown", error: "Tu sesión venció. Volvé a entrar." };

function revalidate() {
  revalidatePath("/dashboard/drafts");
  revalidatePath("/dashboard/inbox");
}

export async function sendDraftAction(
  draftId: string,
  options: { body?: string | null; confirmedDoNotContact?: boolean } = {},
): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  if (!(await canReplyToDraft(supabase, draftId))) return NO_REPLY;
  const service = await createServiceClient();
  const result = await approveDraft({
    user: supabase,
    service,
    userId: user.id,
    draftId,
    body: typeof options.body === "string" ? options.body : null,
    confirmedDoNotContact: options.confirmedDoNotContact === true,
  });
  revalidate();
  return result;
}

export async function discardDraftAction(draftId: string, reason?: string | null): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  if (!(await canReplyToDraft(supabase, draftId))) return NO_REPLY;
  const result = await discardDraft({ user: supabase, userId: user.id, draftId, reason });
  revalidate();
  return result;
}

export async function regenerateDraftAction(draftId: string, instruction?: string | null): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  if (!(await canReplyToDraft(supabase, draftId))) return NO_REPLY;
  const service = await createServiceClient();
  const result = await regenerateDraft({ user: supabase, service, userId: user.id, draftId, instruction });
  revalidate();
  return result;
}

/** El contador del menu (ver `lib/agent/drafts/pending-count.ts`). */
export async function countPendingDrafts(): Promise<PendingDraftCounts> {
  return loadPendingDraftCounts();
}

/** El borrador vivo de una conversacion (bandeja). La RLS acota al scope de leads. */
export async function loadConversationDraft(conversationId: string): Promise<DraftQueueRow | null> {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const { supabase, user } = await session();
  if (!user) return null;
  return loadLiveDraft(supabase, conversationId);
}

/** La ultima sugerencia que una persona descarto en esta conversacion (A1), si todavia se puede recuperar. */
export async function loadConversationDiscardedDraft(conversationId: string): Promise<DraftQueueRow | null> {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const { supabase, user } = await session();
  if (!user) return null;
  return loadLastDiscardedDraft(supabase, conversationId);
}

/**
 * El borrador que vencio sin enviarse (00260), si sigue siendo la ultima
 * palabra en la conversacion: se muestra para copiarlo y mandarlo desde la app
 * de la red, que no tiene el limite de 24 horas.
 */
export async function loadConversationExpiredDraft(conversationId: string): Promise<DraftQueueRow | null> {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const { supabase, user } = await session();
  if (!user) return null;
  return loadLastExpiredDraft(supabase, conversationId);
}

/**
 * "Sugerir respuesta" (A1): pide a mano que el agente redacte una respuesta. Deja un borrador, nunca envia.
 * Pide poder responder por el canal de la conversacion (`inbox.<canal>.reply`); la RLS acota cuales conversaciones se ven.
 */
export async function requestSuggestionAction(conversationId: string): Promise<DraftActionResult> {
  if (typeof conversationId !== "string" || !conversationId) {
    return { ok: false, code: "not_found", error: "No encontré esa conversación." };
  }
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  const access = await getMemberAction();
  if (!access) return NO_REPLY;
  const { data } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, contact_id, deleted_at, channels(platform)")
    .eq("id", conversationId)
    .maybeSingle();
  const conversation = data as unknown as {
    id: string;
    workspace_id: string;
    channel_id: string;
    contact_id: string;
    deleted_at: string | null;
    channels?: { platform?: string } | null;
  } | null;
  if (!conversation || conversation.deleted_at) return { ok: false, code: "not_found", error: "No encontré esa conversación." };
  if (!canReplyChannel(access.permissions, conversation.channel_id)) return NO_REPLY;
  const service = await createServiceClient();
  const result = await requestSuggestion({ service, conversation });
  revalidate();
  return result;
}
