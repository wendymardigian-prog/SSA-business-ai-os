"use server";

import { z } from "zod";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { commentErrorMessage, type CommentEntity, type CommentRow } from "@/lib/team-comments/thread";
import { MAX_COMMENT_LENGTH, MAX_MENTIONS, type MentionCandidate } from "@/lib/team-comments/mentions";

/**
 * Comentarios con @menciones (Servicios A4, F132). Capa fina sobre las funciones de la base (00364): ellas miran
 * la visibilidad con la sesión, filtran las menciones y avisan. Acá: el permiso del módulo (`tasks.view` para una
 * tarea, `calls.view` para una reunión), zod y los errores en palabras. Nunca lanza al cliente.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica; los tipos viven en
 * `lib/team-comments/thread.ts`.
 */

const ENTITY_PERMISSION: Record<CommentEntity, string> = { task: "tasks.view", call: "calls.view" };

const entitySchema = z.object({ entityType: z.enum(["task", "call"]), entityId: z.string().uuid() });
const bodySchema = z.string().trim().min(1, "Escribí un comentario.").max(MAX_COMMENT_LENGTH, `El comentario puede tener hasta ${MAX_COMMENT_LENGTH} caracteres.`);
const mentionsSchema = z.array(z.string().uuid()).max(MAX_MENTIONS).default([]);

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ctxFor(entityType: CommentEntity) {
  const ctx = await getMemberAction();
  if (!ctx || !ctx.can(ENTITY_PERMISSION[entityType])) return null;
  return ctx;
}

function rpcError(error: { message?: string; hint?: string | null } | null, fallback: string): string {
  return commentErrorMessage(error?.hint ?? null, fallback);
}

export type ThreadPayload = {
  rows: CommentRow[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  candidates: MentionCandidate[];
  unreadMentionCommentIds: string[];
  viewerId: string;
};

/** El hilo de una entidad con lo necesario para dibujarlo. Si la sesión no ve la entidad, un hilo vacío. */
export async function loadCommentThread(raw: { entityType: CommentEntity; entityId: string }): Promise<Result<ThreadPayload>> {
  try {
    const input = entitySchema.parse(raw);
    const ctx = await ctxFor(input.entityType);
    if (!ctx) return { ok: false, error: "No tenés permiso para ver esto." };
    const [rowsRes, candRes, members, unreadRes] = await Promise.all([
      ctx.supabase
        .from("comments")
        .select("id, kind, author_id, body, mentions, edited_at, deleted_at, created_at")
        .eq("workspace_id", ctx.workspace.id)
        .eq("entity_type", input.entityType)
        .eq("entity_id", input.entityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(500),
      ctx.supabase.rpc("comment_mention_candidates", { p_entity_type: input.entityType, p_entity_id: input.entityId }),
      getWorkspaceMembers(ctx.workspace.id),
      ctx.supabase
        .from("notifications")
        .select("metadata")
        .eq("workspace_id", ctx.workspace.id)
        .eq("recipient_id", ctx.user.id)
        .eq("type", "mentioned")
        .eq("entity_id", input.entityId)
        .is("read_at", null)
        .limit(50),
    ]);
    if (rowsRes.error) return { ok: false, error: "No pude leer los comentarios." };
    const names: Record<string, string> = {};
    const avatars: Record<string, string | null> = {};
    for (const m of members) {
      names[m.userId] = m.name;
      avatars[m.userId] = m.avatarUrl;
    }
    const candidateIds = new Set(((candRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    const candidates = members.filter((m) => candidateIds.has(m.userId)).map((m) => ({ id: m.userId, name: m.name }));
    const unread = ((unreadRes.data ?? []) as Array<{ metadata: { comment_id?: string } | null }>)
      .map((r) => r.metadata?.comment_id)
      .filter((id): id is string => typeof id === "string");
    return {
      ok: true,
      data: {
        rows: (rowsRes.data ?? []) as CommentRow[],
        names,
        avatars,
        candidates,
        unreadMentionCommentIds: unread,
        viewerId: ctx.user.id,
      },
    };
  } catch (error) {
    console.error("[comentarios] no pude armar el hilo:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude leer los comentarios." };
  }
}

export async function postTeamComment(raw: { entityType: CommentEntity; entityId: string; body: string; mentions?: string[] }): Promise<Result<{ id: string }>> {
  try {
    const parsed = entitySchema.extend({ body: bodySchema, mentions: mentionsSchema }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá el comentario." };
    const ctx = await ctxFor(parsed.data.entityType);
    if (!ctx) return { ok: false, error: "No podés comentar acá." };
    const { data, error } = await ctx.supabase.rpc("post_comment", {
      p_entity_type: parsed.data.entityType,
      p_entity_id: parsed.data.entityId,
      p_body: parsed.data.body,
      p_mentions: parsed.data.mentions,
    });
    if (error || !data) return { ok: false, error: rpcError(error, "No pude guardar el comentario.") };
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    console.error("[comentarios] no pude comentar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude guardar el comentario." };
  }
}

export async function editTeamComment(raw: { entityType: CommentEntity; id: string; body: string; mentions?: string[] }): Promise<Result<null>> {
  try {
    const parsed = z.object({ entityType: z.enum(["task", "call"]), id: z.string().uuid(), body: bodySchema, mentions: mentionsSchema }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá el comentario." };
    const ctx = await ctxFor(parsed.data.entityType);
    if (!ctx) return { ok: false, error: "No podés comentar acá." };
    const { error } = await ctx.supabase.rpc("edit_comment", { p_id: parsed.data.id, p_body: parsed.data.body, p_mentions: parsed.data.mentions });
    if (error) return { ok: false, error: rpcError(error, "No pude editar el comentario.") };
    return { ok: true, data: null };
  } catch (error) {
    console.error("[comentarios] no pude editar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude editar el comentario." };
  }
}

export async function deleteTeamComment(raw: { entityType: CommentEntity; id: string }): Promise<Result<null>> {
  try {
    const parsed = z.object({ entityType: z.enum(["task", "call"]), id: z.string().uuid() }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Ese comentario no existe." };
    const ctx = await ctxFor(parsed.data.entityType);
    if (!ctx) return { ok: false, error: "No podés comentar acá." };
    const { error } = await ctx.supabase.rpc("delete_comment", { p_id: parsed.data.id });
    if (error) return { ok: false, error: rpcError(error, "No pude borrar el comentario.") };
    return { ok: true, data: null };
  } catch (error) {
    console.error("[comentarios] no pude borrar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude borrar el comentario." };
  }
}

/** Abrir la pestaña marca como leídas mis menciones de esa entidad (el contador sale de ahí). */
export async function markEntityMentionsRead(raw: { entityType: CommentEntity; entityId: string }): Promise<Result<{ updated: number }>> {
  try {
    const input = entitySchema.parse(raw);
    const ctx = await ctxFor(input.entityType);
    if (!ctx) return { ok: false, error: "No tenés permiso." };
    const service = await createServiceClient();
    const { data, error } = await service
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("workspace_id", ctx.workspace.id)
      .eq("recipient_id", ctx.user.id)
      .eq("type", "mentioned")
      .eq("entity_id", input.entityId)
      .is("read_at", null)
      .select("id");
    if (error) return { ok: false, error: "No pude marcar las menciones." };
    return { ok: true, data: { updated: data?.length ?? 0 } };
  } catch {
    return { ok: false, error: "No pude marcar las menciones." };
  }
}
