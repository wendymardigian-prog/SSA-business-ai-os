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

/** Los mensajes de un hilo, del más viejo al más nuevo. Con el cliente de la persona, la RLS decide si los ve. */
export async function listMessages(db: Db, threadId: string, limit = 200): Promise<AiMessageRow[]> {
  const { data, error } = await db.from("ai_messages").select(MESSAGE_COLUMNS).eq("thread_id", threadId).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  return (data ?? []) as AiMessageRow[];
}
