"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { logAudit } from "@/lib/audit";
import { validateIdea, draftFromIdea, type IdeaInput } from "@/lib/content/ideas";
import { evaluateDrop } from "@/lib/content/board";
import { canTransition, columnFor, type BoardColumn, type ContentPermissions } from "@/lib/content/status";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * Server Actions del pipeline de contenido (F19, F20).
 *
 * Tres reglas, las mismas que en integraciones:
 *
 *  1. El permiso se revalida ACA y ademas lo aplica la RLS (00083). La
 *     pantalla decide que botones muestra; la barrera es la base.
 *  2. Todo lo que decide algo (si se puede mover, que post sale de una idea)
 *     vive en funciones puras y testeadas: aca solo se lee, se llama y se
 *     escribe.
 *  3. Aprobar una idea pasa por la funcion SQL, que hace las dos escrituras en
 *     una transaccion.
 */

const CONTENT_PATH = "/dashboard/content";

export type ContentActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Lo que puede hacer quien esta llamando. En el bloque 9 pasa a permisos. */
async function contentContext() {
  const { workspace, user, role, supabase } = await getWorkspace();
  const admin = isAdminRole(role);
  return {
    workspace,
    user,
    supabase,
    perms: (isAuthor: boolean): ContentPermissions => ({
      create: true,
      approve: admin,
      publish: admin,
      isAuthor,
    }),
    isAdmin: admin,
  };
}

// ── Ideas ────────────────────────────────────────────────────────────────

export async function createIdea(input: IdeaInput): Promise<ContentActionResult<{ id: string }>> {
  const checked = validateIdea(input);
  if (!checked.ok) return checked;

  const { workspace, user, supabase } = await contentContext();

  // Al final de la columna. Se lee el maximo en vez de contar filas: contar da
  // el numero equivocado apenas alguien reordena.
  const { data: last } = await supabase
    .from("content_ideas")
    .select("position")
    .eq("workspace_id", workspace.id)
    .eq("status", "nueva")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("content_ideas")
    .insert({
      ...checked.idea,
      workspace_id: workspace.id,
      created_by: user.id,
      position: (last?.position ?? 0) + 10,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[content] no pude crear la idea:", error?.message);
    return { ok: false, error: "No pude guardar la idea" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: data.id } };
}

export async function approveIdea(
  ideaId: string,
): Promise<ContentActionResult<{ postId: string }>> {
  const { workspace, user, supabase, isAdmin } = await contentContext();
  if (!isAdmin) return { ok: false, error: "Aprobar ideas es de Owner y Admin" };

  const { data: idea, error: readError } = await supabase
    .from("content_ideas")
    .select("id, title, hook, angle, format, notes, status")
    .eq("id", ideaId)
    .maybeSingle();

  if (readError || !idea) return { ok: false, error: "No encontre esa idea" };
  if (idea.status !== "nueva") return { ok: false, error: "Esa idea ya estaba decidida" };

  const draft = draftFromIdea({ ...idea, status: idea.status });

  const { data: postId, error } = await supabase.rpc("approve_content_idea", {
    p_idea_id: ideaId,
    p_title: draft.title,
    p_format: draft.format,
    p_copy: draft.copy,
  });

  if (error || !postId) {
    console.error("[content] no pude aprobar la idea:", error?.message);
    return {
      ok: false,
      error:
        error?.message?.includes("idea_ya_decidida")
          ? "Esa idea ya estaba decidida"
          : "No pude aprobar la idea",
    };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "create",
    metadata: { kind: "content_idea_approved", idea_id: ideaId, post_id: postId },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { postId: postId as string } };
}

export async function discardIdea(
  ideaId: string,
  reason?: string,
): Promise<ContentActionResult> {
  const { workspace, user, supabase, isAdmin } = await contentContext();
  if (!isAdmin) return { ok: false, error: "Descartar ideas es de Owner y Admin" };

  const { error } = await supabase
    .from("content_ideas")
    .update({
      status: "descartada",
      discarded_reason: reason?.trim() || null,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", ideaId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[content] no pude descartar la idea:", error.message);
    return { ok: false, error: "No pude descartar la idea" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

// ── Posts ────────────────────────────────────────────────────────────────

export interface NewPostInput {
  title: string;
  format?: string | null;
  ideaId?: string | null;
  platforms?: string[];
}

export async function createPost(
  input: NewPostInput,
): Promise<ContentActionResult<{ id: string }>> {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "La pieza necesita un titulo" };

  const { workspace, user, supabase } = await contentContext();

  const { data: last } = await supabase
    .from("content_posts")
    .select("position")
    .eq("workspace_id", workspace.id)
    .eq("status", "draft")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Las redes elegidas entran sin fecha: elegir la red es decir "va a ir aca",
  // no "sale tal dia". La fecha se pone en el editor.
  const networks = (input.platforms ?? []).map((platform) => ({
    platform,
    planned_at: null,
    caption: null,
    media: null,
    cta: { type: "none", keyword: null },
    options: {},
  }));

  const { data, error } = await supabase
    .from("content_posts")
    .insert({
      workspace_id: workspace.id,
      idea_id: input.ideaId ?? null,
      title,
      format: input.format ?? null,
      networks,
      created_by: user.id,
      position: (last?.position ?? 0) + 10,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[content] no pude crear la pieza:", error?.message);
    return { ok: false, error: "No pude crear la pieza" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: data.id } };
}

/**
 * Mueve una pieza de columna.
 *
 * La decision es de `evaluateDrop`, que ya esta testeada. Aca se lee el estado
 * real antes de decidir: el tablero que ve la persona puede estar viejo, y
 * mover segun lo que ella ve en vez de lo que hay seria pisar un cambio de
 * otro.
 */
export async function movePostToColumn(
  postId: string,
  target: BoardColumn,
): Promise<ContentActionResult<{ status: ContentPostStatus }>> {
  const { workspace, user, supabase, perms } = await contentContext();

  const { data: post, error: readError } = await supabase
    .from("content_posts")
    .select("id, status, created_by, networks")
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (readError || !post) return { ok: false, error: "No encontre esa pieza" };

  const networks = (Array.isArray(post.networks) ? post.networks : []) as Array<{
    platform?: string;
    planned_at?: string | null;
  }>;

  const decision = evaluateDrop({
    perms: perms(post.created_by === user.id),
    post: {
      status: post.status,
      networks: networks.map((n) => ({
        platform: String(n.platform ?? ""),
        at: n.planned_at ?? null,
        status: null,
      })),
    },
    target,
  });

  if (!decision.ok) return { ok: false, error: decision.reason };

  // Programar de verdad (crear las filas y los jobs) es F25. Mover la tarjeta
  // a esa columna sin eso dejaria una pieza que dice "programada" y no tiene
  // nada agendado, que es peor que no dejar moverla.
  if (decision.status === "scheduled") {
    return {
      ok: false,
      error: "Programar se hace desde el editor, eligiendo la fecha de cada red.",
    };
  }

  const { error } = await supabase
    .from("content_posts")
    .update({ status: decision.status })
    .eq("id", postId);

  if (error) {
    console.error("[content] no pude mover la pieza:", error.message);
    return { ok: false, error: "No pude mover la pieza" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_post_status", post_id: postId, from: post.status, to: decision.status },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { status: decision.status } };
}

/** Cambia el estado del material, que puede empujar la pieza a produccion. */
export async function setMaterialStatus(
  postId: string,
  material: "pendiente" | "grabado" | "editado" | "listo",
): Promise<ContentActionResult<{ status: ContentPostStatus }>> {
  const { workspace, user, supabase, perms } = await contentContext();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, created_by")
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const { statusAfterMaterialChange } = await import("@/lib/content/status");
  const next = statusAfterMaterialChange(post.status, material);

  if (next !== post.status) {
    const allowed = canTransition(perms(post.created_by === user.id), post.status, next);
    if (!allowed.ok) return { ok: false, error: allowed.reason };
  }

  const { error } = await supabase
    .from("content_posts")
    .update({ material_status: material, status: next })
    .eq("id", postId);

  if (error) return { ok: false, error: "No pude guardar el estado del material" };

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { status: next } };
}

/** El orden dentro de una columna, ya calculado por `reorder`. */
export async function saveOrder(
  positions: Array<{ id: string; position: number }>,
): Promise<ContentActionResult> {
  if (positions.length === 0) return { ok: true };

  const { workspace, supabase } = await contentContext();

  for (const { id, position } of positions) {
    const { error } = await supabase
      .from("content_posts")
      .update({ position })
      .eq("id", id)
      .eq("workspace_id", workspace.id);
    if (error) {
      console.error("[content] no pude guardar el orden:", error.message);
      return { ok: false, error: "No pude guardar el orden" };
    }
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

/** La columna en la que se dibuja una pieza, para la pantalla. */
export async function columnForStatus(status: ContentPostStatus): Promise<BoardColumn> {
  return columnFor(status);
}
