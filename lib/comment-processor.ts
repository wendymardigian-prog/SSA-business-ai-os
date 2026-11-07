import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { executeFlow } from "@/lib/flow-engine/engine";
import { keywordMatches } from "@/lib/flow-engine/registry/triggers";
import type { TriggerRow } from "@/lib/flow-engine/registry/types";
import { createZernioClient } from "@/lib/zernio-client";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { resolveContentForPost } from "@/lib/attribution/content-variables";
import { applyConversationRules } from "@/lib/conversations/assignment";
import { fallbackContactName } from "@/lib/contacts/anonymous";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

export interface IncomingComment {
  id: string;
  postId: string;
  text: string;
  author: { id?: string; name?: string; username?: string; picture?: string };
}

export type CommentForMatching = Pick<IncomingComment, "postId"> & { text: string };

interface CommentKeywordConfig {
  keywords?: Array<{
    value: string;
    matchType?: "exact" | "contains" | "startsWith";
  }>;
  postIds?: string[];
  replyText?: string;
}

/**
 * Returns the first trigger whose keywords match the comment text, honoring
 * per-keyword matchType and optional postIds scoping. Triggers are checked in
 * array order — callers pass them pre-sorted by priority.
 */
export function matchCommentTrigger(
  triggers: Trigger[],
  comment: CommentForMatching,
): Trigger | null {
  const text = comment.text.toLowerCase().trim();
  if (!text) return null;

  for (const trigger of triggers) {
    const config = trigger.config as unknown as CommentKeywordConfig;
    // El filtro por publicacion es propio de los comentarios: acota el trigger
    // a posts puntuales. La comparacion de palabras clave en si la hace el
    // registro, para que no queden dos implementaciones que se separen.
    if (config.postIds?.length && !config.postIds.includes(comment.postId)) continue;

    const matched = keywordMatches({
      trigger: trigger as unknown as TriggerRow,
      config: (trigger.config ?? {}) as Record<string, unknown>,
      message: { text: comment.text },
      text,
      isFirstMessage: false,
    });

    if (matched) return trigger;
  }

  return null;
}

export async function getActiveCommentTriggers(
  supabase: SupabaseClient<Database>,
  { channelId, workspaceId }: { channelId: string; workspaceId: string },
): Promise<Trigger[]> {
  // Null channel_id means workspace-wide, NOT global — pin to the channel's
  // workspace so one tenant's triggers never run on another tenant's channels.
  const { data: triggers } = await supabase
    .from("triggers")
    .select("*, flows!inner(status, workspace_id)")
    .eq("type", "comment_keyword")
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", workspaceId)
    .order("priority", { ascending: false });

  return (triggers as Trigger[] | null) ?? [];
}

export interface ProcessCommentResult {
  matched: boolean;
  skipped?: "already_processed" | "do_not_contact";
  triggerId?: string;
  error?: string;
}

/**
 * Process one inbound comment against the channel's comment_keyword triggers:
 * upsert the contact, optionally post the configured public reply, and execute
 * the flow (which sends the DM via its privateReply node using the comment_id
 * and post_id variables set here). Idempotent across webhook redeliveries via
 * the (channel_id, platform_comment_id) unique log row.
 */
export async function processComment({
  supabase,
  channel,
  comment,
}: {
  supabase: SupabaseClient<Database>;
  channel: Channel;
  comment: IncomingComment;
}): Promise<ProcessCommentResult> {
  const { data: alreadyLogged } = await supabase
    .from("comment_logs")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("platform_comment_id", comment.id)
    .maybeSingle();

  if (alreadyLogged) return { matched: false, skipped: "already_processed" };

  const triggers = await getActiveCommentTriggers(supabase, {
    channelId: channel.id,
    workspaceId: channel.workspace_id,
  });
  const matchedTrigger = matchCommentTrigger(triggers, comment);

  if (!matchedTrigger) {
    await logComment({ supabase, channel, comment, triggerId: null });
    return { matched: false };
  }

  const config = matchedTrigger.config as unknown as CommentKeywordConfig;

  // Reclamo atomico (auditoria de automatizaciones): dos entregas del mismo comentario a la vez pasaban las dos el
  // "ya esta registrado?" de arriba y respondian dos veces. El indice unico de trigger_fires decide quien sigue.
  const { error: claimError } = await supabase.from("trigger_fires").insert({
    trigger_id: matchedTrigger.id,
    workspace_id: channel.workspace_id,
    dedupe_key: `comment:${channel.id}:${comment.id}`,
    contact_id: null,
  });
  if (claimError) {
    if (claimError.code === "23505") return { matched: false, skipped: "already_processed" };
    console.error("[comments] no pude reclamar el comentario:", claimError.message);
  }

  try {
    const senderId = comment.author.id || `comment_${comment.id}`;
    const senderName = fallbackContactName(comment.author.name, comment.author.username, "Unknown commenter");

    // Misma resolucion de contacto que el webhook de mensajes: un lead que
    // comenta y despues manda un DM tiene que ser un solo contacto.
    const contact = await upsertContactForSender({
      supabase,
      channel,
      senderId,
      senderName,
      // El payload de comentarios SI trae author.picture (F16): antes se
      // mandaba null a mano, perdiendo la foto para todo contacto que
      // entraba por un comentario en vez de por un DM.
      senderPicture: comment.author.picture || null,
      senderUsername: comment.author.username || null,
      interactionAt: new Date().toISOString(),
    });

    if (!contact) {
      return { matched: true, triggerId: matchedTrigger.id, error: "Failed to create contact" };
    }

    const contactId = contact.contactId;

    // «No contactar» vale tambien para los comentarios: ni respuesta publica ni mensaje privado.
    const { data: contactFlags } = await supabase.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
    if ((contactFlags as { do_not_contact?: boolean } | null)?.do_not_contact) {
      await logComment({ supabase, channel, comment, triggerId: matchedTrigger.id });
      return { matched: true, triggerId: matchedTrigger.id, skipped: "do_not_contact" };
    }

    // Local conversation only — there is no Zernio DM conversation until the
    // flow's privateReply node creates one, so late_conversation_id stays null
    // and sendMessage nodes in comment flows are no-ops until the contact replies.
    const { data: conversation } = await supabase
      .from("conversations")
      .upsert(
        {
          workspace_id: channel.workspace_id,
          channel_id: channel.id,
          contact_id: contactId,
          platform: channel.platform,
          status: "open",
          last_message_at: new Date().toISOString(),
          last_message_preview: `[Comment] ${comment.text.slice(0, 80)}`,
        },
        { onConflict: "channel_id,contact_id" },
      )
      .select("id")
      .single();

    // Las reglas de asignacion por cuenta (00255). Es un upsert y no se sabe si
    // la conversacion es nueva: la RPC solo asigna si todavia no tiene
    // responsable, asi que nunca pisa a nadie.
    if (conversation) await applyConversationRules(supabase, { workspaceId: channel.workspace_id, conversationId: conversation.id });

    let dmSent = false;
    let outcome: CommentDeliveryOutcome = { dmSent: false, privateReplyFailed: false, pending: false };
    const flowStartedAt = new Date().toISOString();
    if (conversation) {
      try {
        const sessionId = await executeFlow(supabase, {
          triggerId: matchedTrigger.id,
          flowId: matchedTrigger.flow_id,
          channelId: channel.id,
          contactId,
          conversationId: conversation.id,
          workspaceId: channel.workspace_id,
          lateAccountId: channel.late_account_id,
          incomingMessage: {
            text: comment.text,
            sender: {
              id: senderId,
              name: comment.author.name,
              username: comment.author.username,
            },
          },
          variables: {
            comment_id: comment.id,
            comment_text: comment.text,
            // La variable de los flujos queda como siempre (sin "@"): el "@usuario"
            // es solo el nombre con el que nace el contacto.
            commenter_name: comment.author.name || comment.author.username || "Unknown commenter",
            post_id: comment.postId,
            // La pieza comentada (Extra I, F34): `{{content.title}}`. Null si la publicación no es de este sistema.
            content: await resolveContentForPost(supabase, { workspaceId: channel.workspace_id, platform: channel.platform, externalPostId: comment.postId }),
          },
        });
        // «DM enviado» es que el mensaje salio de verdad: antes alcanzaba con que el flujo no lanzara, y una respuesta
        // privada rechazada (el paso no lanza) contaba como enviada.
        outcome = await commentDeliveryOutcome(supabase, {
          sessionId: sessionId ?? null,
          conversationId: conversation.id,
          flowId: matchedTrigger.flow_id,
          since: flowStartedAt,
        });
        dmSent = outcome.dmSent;
      } catch (err) {
        console.error("Failed to execute comment flow:", err);
      }
    }

    // La respuesta publica va DESPUES del flujo, y no sale si la respuesta privada fallo: un «Te envie por DM!» sin DM
    // confunde a quien comento (paso el 6/11/2026, cuando otra app contesto primero).
    let replySent = false;
    if (config.replyText && shouldPostPublicReply(outcome)) {
      const apiKey = await getZernioApiKey(channel.workspace_id, { supabase });

      if (apiKey) {
        try {
          const zernio = createZernioClient(apiKey);
          await zernio.comments.replyToInboxPost({
            path: { postId: comment.postId },
            body: {
              accountId: channel.late_account_id,
              message: config.replyText,
              commentId: comment.id,
            },
          });
          replySent = true;
        } catch (err) {
          console.error("[comments] no pude publicar la respuesta al comentario:", err instanceof Error ? err.name : "error");
        }
      }
    }

    await supabase.from("analytics_events").insert({
      workspace_id: channel.workspace_id,
      flow_id: matchedTrigger.flow_id,
      contact_id: contactId,
      event_type: "comment_matched",
      metadata: {
        triggerId: matchedTrigger.id,
        postId: comment.postId,
        commentId: comment.id,
        dmSent,
        replySent,
      } as unknown as Json,
    });

    await logComment({
      supabase,
      channel,
      comment,
      triggerId: matchedTrigger.id,
      dmSent,
      replySent,
    });

    return { matched: true, triggerId: matchedTrigger.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logComment({
      supabase,
      channel,
      comment,
      triggerId: matchedTrigger.id,
      error: errorMessage,
    });
    return { matched: true, triggerId: matchedTrigger.id, error: errorMessage };
  }
}

/** Lo que paso con el mensaje privado de una automatizacion de comentario. */
export interface CommentDeliveryOutcome {
  /** Salio al menos un mensaje del flujo en esa conversacion. */
  dmSent: boolean;
  /** Hubo un mensaje del flujo que no salio (la respuesta privada rechazada). */
  privateReplyFailed: boolean;
  /** Un paso quedo para reintentar (todavia no se sabe). */
  pending: boolean;
}

/** La respuesta publica solo si el DM salio, o si el flujo no intento ninguno (una regla sin respuesta privada). */
export function shouldPostPublicReply(outcome: CommentDeliveryOutcome): boolean {
  if (outcome.dmSent) return true;
  return !outcome.privateReplyFailed && !outcome.pending;
}

/** Lee de la base que paso con los mensajes del flujo despues de correrlo. Ante un error, «no se sabe»: no se publica. */
export async function commentDeliveryOutcome(
  supabase: SupabaseClient<Database>,
  args: { sessionId: string | null; conversationId: string; flowId: string; since: string },
): Promise<CommentDeliveryOutcome> {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("status")
      .eq("conversation_id", args.conversationId)
      .eq("sent_by_flow_id", args.flowId)
      .gte("created_at", args.since);
    if (error) throw error;
    const statuses = (messages ?? []).map((m) => (m as { status: string }).status);
    let pending = false;
    if (args.sessionId) {
      const { data: steps } = await supabase.from("flow_session_steps").select("status").eq("session_id", args.sessionId).eq("status", "deferred");
      pending = (steps ?? []).length > 0;
    }
    return {
      dmSent: statuses.some((s) => s !== "failed" && s !== "pending"),
      privateReplyFailed: statuses.includes("failed"),
      pending,
    };
  } catch (err) {
    console.error("[comments] no pude leer como salio el mensaje del comentario:", err instanceof Error ? err.name : "error");
    return { dmSent: false, privateReplyFailed: true, pending: false };
  }
}

async function logComment({
  supabase,
  channel,
  comment,
  triggerId,
  dmSent = false,
  replySent = false,
  error,
}: {
  supabase: SupabaseClient<Database>;
  channel: Channel;
  comment: IncomingComment;
  triggerId: string | null;
  dmSent?: boolean;
  replySent?: boolean;
  error?: string;
}): Promise<void> {
  await supabase.from("comment_logs").upsert(
    {
      channel_id: channel.id,
      workspace_id: channel.workspace_id,
      post_id: comment.postId,
      platform_comment_id: comment.id,
      author_id: comment.author.id || null,
      author_name: comment.author.name || null,
      author_username: comment.author.username || null,
      comment_text: comment.text,
      matched_trigger_id: triggerId,
      dm_sent: dmSent,
      reply_sent: replySent,
      ...(error ? { error } : {}),
    },
    { onConflict: "channel_id,platform_comment_id" },
  );
}
