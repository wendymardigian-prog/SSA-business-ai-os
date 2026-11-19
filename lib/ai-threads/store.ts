/**
 * Escribir y leer conversaciones con IA (`ai_threads` / `ai_messages`).
 *
 * Escribe SOLO el servidor, con el cliente de servicio y DESPUÉS de chequear el
 * permiso y el negocio (las tablas no tienen políticas de escritura). Lo que se
 * guarda en `context` y `result` se valida con el esquema del canal
 * (`./schema.ts`) antes de escribir.
 *
 * El Diseñador IA tiene UN hilo por diseño o plantilla (índice único parcial):
 * `getOrCreateDesignerThread` lo busca o lo crea sin duplicar, aunque dos
 * pedidos lleguen a la vez.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { designerSubjectType, parseAttachments, parseMessageContext, parseMessageResult, type AiAttachment, type AiMessageRole, type AiThreadChannel } from "./schema";

type Db = SupabaseClient<Database>;

export type AiThreadRow = Database["public"]["Tables"]["ai_threads"]["Row"];
export type AiMessageRow = Database["public"]["Tables"]["ai_messages"]["Row"];

const THREAD_COLUMNS = "id, workspace_id, channel, agent_id, user_id, contact_id, subject_type, subject_id, title, last_message_at, archived_at, created_by, created_at, updated_at";
const MESSAGE_COLUMNS = "id, workspace_id, thread_id, role, content, attachments, context, result, citations, agent_run_id, feedback, created_at";

/** El hilo del Diseñador IA de un diseño o una plantilla: lo busca o lo crea. */
export async function getOrCreateDesignerThread(
  service: Db,
  input: { workspaceId: string; kind: "design" | "template"; subjectId: string; userId: string | null; title?: string | null },
): Promise<AiThreadRow> {
  const subjectType = designerSubjectType(input.kind);
  const find = async () => {
    const { data, error } = await service
      .from("ai_threads")
      .select(THREAD_COLUMNS)
      .eq("channel", "designer")
      .eq("subject_type", subjectType)
      .eq("subject_id", input.subjectId)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
    return data as AiThreadRow | null;
  };
  const existing = await find();
  if (existing) {
    if (existing.workspace_id !== input.workspaceId) throw new Error("La conversación es de otro negocio");
    return existing;
  }
  const { data, error } = await service
    .from("ai_threads")
    .insert({ workspace_id: input.workspaceId, channel: "designer", subject_type: subjectType, subject_id: input.subjectId, user_id: input.userId, created_by: input.userId, title: input.title ?? null })
    .select(THREAD_COLUMNS)
    .single();
  if (error) {
    // 23505: otro pedido lo creó en el mismo instante; se usa ese.
    if (error.code === "23505") {
      const again = await find();
      if (again) return again;
    }
    throw new Error(`No se pudo crear la conversación: ${error.message}`);
  }
  return data as AiThreadRow;
}

/**
 * El hilo vigente del asistente de una persona (B-IA-27): el último sin archivar, o uno nuevo. Un hilo del
 * asistente es SOLO de esa persona (la RLS de la 00320 lo deja leer solo a su dueño).
 */
export async function getOrCreateAssistantThread(service: Db, input: { workspaceId: string; userId: string }): Promise<AiThreadRow> {
  const found = await findAssistantThread(service, input);
  if (found) return found;
  const { data, error } = await service
    .from("ai_threads")
    .insert({ workspace_id: input.workspaceId, channel: "assistant", user_id: input.userId, created_by: input.userId })
    .select(THREAD_COLUMNS)
    .single();
  if (error) throw new Error(`No se pudo crear la conversación: ${error.message}`);
  return data as AiThreadRow;
}

/** El hilo vigente del asistente, sin crearlo. */
export async function findAssistantThread(db: Db, input: { workspaceId: string; userId: string }): Promise<AiThreadRow | null> {
  const { data, error } = await db
    .from("ai_threads")
    .select(THREAD_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("channel", "assistant")
    .eq("user_id", input.userId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  return (data as AiThreadRow | null) ?? null;
}

/** «Nueva conversación»: archiva los hilos vigentes de la persona (no se borra nada). */
export async function archiveAssistantThreads(service: Db, input: { workspaceId: string; userId: string; now?: Date }): Promise<void> {
  const { error } = await service
    .from("ai_threads")
    .update({ archived_at: (input.now ?? new Date()).toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("channel", "assistant")
    .eq("user_id", input.userId)
    .is("archived_at", null);
  if (error) throw new Error(`No se pudo empezar una conversación nueva: ${error.message}`);
}

export interface NewMessage {
  role: AiMessageRole;
  content: string;
  attachments?: AiAttachment[];
  context?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  agentRunId?: string | null;
}

/** Suma un mensaje al hilo, validando su forma según el canal, y mueve `last_message_at`. */
export async function appendMessage(service: Db, thread: Pick<AiThreadRow, "id" | "workspace_id" | "channel">, message: NewMessage): Promise<AiMessageRow> {
  const channel = thread.channel as AiThreadChannel;
  const context = parseMessageContext(channel, message.context ?? (channel === "designer" ? { scope: {} } : {}));
  if (!context.ok) throw new Error(`El contexto del mensaje no es válido: ${context.error}`);
  const attachments = parseAttachments(message.attachments ?? []);
  if (!attachments.ok) throw new Error(`Los adjuntos no son válidos: ${attachments.error}`);
  let result: Json | null = null;
  if (message.result) {
    const parsed = parseMessageResult(channel, message.result);
    if (!parsed.ok) throw new Error(`El resultado del mensaje no es válido: ${parsed.error}`);
    result = parsed.value as Json;
  }
  const { data, error } = await service
    .from("ai_messages")
    .insert({
      workspace_id: thread.workspace_id,
      thread_id: thread.id,
      role: message.role,
      content: message.content.slice(0, 20_000),
      attachments: attachments.value as unknown as Json,
      context: context.value as Json,
      result,
      agent_run_id: message.agentRunId ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
  const row = data as AiMessageRow;
  const { error: touchError } = await service.from("ai_threads").update({ last_message_at: row.created_at }).eq("id", thread.id);
  if (touchError) console.error("[ai-threads] no pude mover last_message_at:", touchError.message);
  return row;
}

/** Cambia el resultado de un mensaje (por ejemplo, una propuesta aceptada o rechazada). */
export async function updateMessageResult(service: Db, thread: Pick<AiThreadRow, "id" | "channel">, messageId: string, result: Record<string, unknown>): Promise<void> {
  const parsed = parseMessageResult(thread.channel as AiThreadChannel, result);
  if (!parsed.ok) throw new Error(`El resultado del mensaje no es válido: ${parsed.error}`);
  const { error } = await service.from("ai_messages").update({ result: parsed.value as Json }).eq("id", messageId).eq("thread_id", thread.id);
  if (error) throw new Error(`No se pudo actualizar el mensaje: ${error.message}`);
}

/**
 * Cambia texto y resultado de un mensaje que se va escribiendo paso a paso (el asistente, B-IA-28). Con `onlyIfStatus`,
 * solo si su `result.status` (y `heartbeat_at`) siguen siendo esos (así dos pestañas no reanudan la misma respuesta). Devuelve la fila, o
 * null si no se cambió nada.
 */
export async function updateMessage(
  service: Db,
  thread: Pick<AiThreadRow, "id" | "channel">,
  messageId: string,
  patch: { content?: string; result: Record<string, unknown> },
  match?: { status?: string; heartbeat_at?: string },
): Promise<AiMessageRow | null> {
  const parsed = parseMessageResult(thread.channel as AiThreadChannel, patch.result);
  if (!parsed.ok) throw new Error(`El resultado del mensaje no es válido: ${parsed.error}`);
  const values: Record<string, unknown> = { result: parsed.value as Json };
  if (patch.content !== undefined) values.content = patch.content.slice(0, 20_000);
  let q = service.from("ai_messages").update(values).eq("id", messageId).eq("thread_id", thread.id);
  if (match?.status) q = q.eq("result->>status", match.status);
  if (match?.heartbeat_at) q = q.eq("result->>heartbeat_at", match.heartbeat_at);
  const { data, error } = await q.select(MESSAGE_COLUMNS).maybeSingle();
  if (error) throw new Error(`No se pudo actualizar el mensaje: ${error.message}`);
  return (data as AiMessageRow | null) ?? null;
}

/** Los mensajes de un hilo, del más viejo al más nuevo. Con el cliente de la persona, la RLS decide si los ve. */
export async function listMessages(db: Db, threadId: string, limit = 200): Promise<AiMessageRow[]> {
  const { data, error } = await db.from("ai_messages").select(MESSAGE_COLUMNS).eq("thread_id", threadId).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  return (data ?? []) as AiMessageRow[];
}
