"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { validateIdea, draftFromIdea, type IdeaInput } from "@/lib/content/ideas";
import { evaluateDrop } from "@/lib/content/board";
import { plannedDateChanges } from "@/lib/content/reschedule";
import { canRedistribute, duplicateAsVariant } from "@/lib/content/redistribution";
import { defaultOptionsFor } from "@/lib/content/network-options";
import { enqueueCopy } from "@/lib/content/copy-queue";
import { readCopywriterConfig } from "@/lib/content/copywriter";
import { createServiceClient } from "@/lib/supabase/server";
import { reschedulePublication } from "@/lib/publishing/reschedule";
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

/**
 * Lo que puede hacer quien esta llamando.
 *
 * Por permiso y no por cargo (A20): un rol personalizado con
 * `content.publish` programa aunque sea Member, y un admin al que se lo
 * sacaron, no.
 */
async function contentContext() {
  const { workspace, user, supabase, can } = await getPermissionContext();
  const admin = can("content.approve") || can("content.publish");
  return {
    workspace,
    user,
    supabase,
    perms: (isAuthor: boolean): ContentPermissions => ({
      create: true,
      approve: can("content.approve"),
      publish: can("content.publish"),
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

/**
 * Aprueba una idea y crea el post en borrador.
 *
 * `produceCopy` es el boton "✦ Aprobar y producir copy": ademas le pide al
 * copywriter que escriba. Antes los dos botones hacian exactamente lo mismo
 * y el ✦ era solo un icono (C1).
 */
export async function approveIdea(
  ideaId: string,
  options: { produceCopy?: boolean } = {},
): Promise<ContentActionResult<{ postId: string; copyQueued: boolean; copyError?: string }>> {
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

  // El copy lo pide el boton, o el interruptor "producir al aprobar" que se
  // configura en el agente (E7). Que no se pueda escribir no deshace la
  // aprobacion: la idea ya paso a ser un post.
  let copyQueued = false;
  let copyError: string | undefined;

  const service = await createServiceClient();
  const wantsCopy = options.produceCopy === true || (await autoCopyOnApprove(supabase, workspace.id));

  if (wantsCopy) {
    const queued = await enqueueCopy(service, {
      workspaceId: workspace.id,
      postId: postId as string,
    });
    copyQueued = queued.ok;
    if (!queued.ok) copyError = queued.error;
  }

  revalidatePath(CONTENT_PATH);
  return {
    ok: true,
    data: { postId: postId as string, copyQueued, ...(copyError ? { copyError } : {}) },
  };
}

/** Si el copywriter tiene prendido "producir el copy al aprobar una idea". */
async function autoCopyOnApprove(
  supabase: Awaited<ReturnType<typeof contentContext>>["supabase"],
  workspaceId: string,
): Promise<boolean> {
  const { data: agent } = await supabase
    .from("agents")
    .select("system_prompt, config, knowledge_tags")
    .eq("workspace_id", workspaceId)
    .eq("type", "copywriter")
    .is("deleted_at", null)
    .maybeSingle();

  return readCopywriterConfig(agent, null).autoOnApprove;
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

/**
 * Mueve las publicaciones de las redes que ya estaban programadas y cambiaron
 * de fecha en el editor (A5).
 *
 * Devuelve los avisos de las que no se pudieron mover, para mostrarlos sin
 * frenar el guardado: perder el texto que alguien acaba de escribir porque
 * una fecha quedo muy cerca seria peor.
 */
async function applyPlannedDateChanges(
  workspaceId: string,
  postId: string,
  networks: unknown[],
): Promise<string[]> {
  const plans = (networks as Array<{ platform?: string; planned_at?: string | null }>).map((n) => ({
    platform: String(n.platform ?? ""),
    plannedAt: n.planned_at ?? null,
  }));

  const service = await createServiceClient();

  const { data: publications } = await service
    .from("social_posts")
    .select("id, platform, status, scheduled_at")
    .eq("content_post_id", postId)
    .is("deleted_at", null);

  const decisions = plannedDateChanges(
    plans,
    (publications ?? []).map((p) => ({
      platform: p.platform,
      status: p.status,
      scheduledAt: p.scheduled_at,
    })),
  );

  const warnings: string[] = [];

  for (const decision of decisions) {
    if (decision.kind === "skip") {
      warnings.push(`${decision.platform}: ${decision.reason}`);
      continue;
    }

    const row = (publications ?? []).find((p) => p.platform === decision.platform);
    if (!row) continue;

    const moved = await reschedulePublication(service, {
      socialPostId: row.id,
      workspaceId,
      at: decision.at,
    });
    if (!moved) warnings.push(`${decision.platform}: no pude mover la publicacion.`);
  }

  return warnings;
}

/** Guarda los campos del editor. El autoguardado llama a esto. */
export async function savePostDraft(input: {
  postId: string;
  title?: string;
  format?: string | null;
  copy?: Record<string, unknown>;
  caption?: string | null;
  networks?: unknown[];
  /** Para detectar que alguien mas lo edito mientras tanto. */
  knownUpdatedAt?: string;
}): Promise<
  ContentActionResult<{ updatedAt: string; staleWarning: boolean; rescheduleWarnings: string[] }>
> {
  const { workspace, supabase } = await contentContext();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, updated_at, status")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  // Gana el ultimo que guarda, pero se avisa: perder el trabajo de otro sin
  // enterarse es peor que tener que copiar y pegar.
  const stale = Boolean(input.knownUpdatedAt && input.knownUpdatedAt !== post.updated_at);

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.format !== undefined) patch.format = input.format;
  if (input.copy !== undefined) patch.copy = input.copy;
  if (input.caption !== undefined) patch.caption = input.caption;
  if (input.networks !== undefined) patch.networks = input.networks;

  // Editar a mano marca el copy como revisado: la advertencia de "generado
  // con IA, revisalo" deja de tener sentido apenas alguien lo toca.
  if (input.copy !== undefined) patch.ai_unreviewed = false;

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: { updatedAt: post.updated_at, staleWarning: stale, rescheduleWarnings: [] } };
  }

  const { data: updated, error } = await supabase
    .from("content_posts")
    .update(patch)
    .eq("id", input.postId)
    .select("updated_at")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "No pude guardar los cambios" };
  }

  // Cambiar la fecha de una red YA programada tiene que mover la publicacion
  // de verdad (A5). Antes solo se guardaba el campo y la publicacion salia a
  // la hora vieja: la pantalla decia una cosa y el sistema hacia otra.
  const rescheduleWarnings = input.networks
    ? await applyPlannedDateChanges(workspace.id, input.postId, input.networks)
    : [];

  revalidatePath(CONTENT_PATH);
  return {
    ok: true,
    data: { updatedAt: updated.updated_at, staleWarning: stale, rescheduleWarnings },
  };
}

// ── Redistribucion y variantes (A18) ─────────────────────────────────────

/**
 * Agrega una red a una pieza que ya salio (F28).
 *
 * `canRedistribute` existia desde el bloque 4 y no la llamaba nadie: la
 * pantalla no tenia por donde. Lo que decide esta ahi; aca se lee el estado,
 * se aplica y, si el copy cambio despues de aprobar, esa red vuelve a
 * revision en vez de salir con algo que nadie aprobo.
 */
export async function redistributeToNetwork(input: {
  postId: string;
  platform: string;
}): Promise<ContentActionResult<{ needsReview: boolean; reason?: string }>> {
  const { workspace, supabase } = await contentContext();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, networks, approved_at, updated_at")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const [{ data: publications }, { data: accounts }] = await Promise.all([
    supabase.from("social_posts").select("platform").eq("content_post_id", post.id).is("deleted_at", null),
    supabase
      .from("social_accounts")
      .select("platform")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
  ]);

  const decision = canRedistribute(input.platform, {
    postStatus: post.status as ContentPostStatus,
    publishedPlatforms: (publications ?? []).map((p) => p.platform),
    connected: (accounts ?? []).map((a) => a.platform),
    baseChangedSinceApproval: Boolean(
      post.approved_at && post.updated_at && post.updated_at > post.approved_at,
    ),
  });

  if (!decision.ok) return { ok: false, error: decision.error };

  const networks = (Array.isArray(post.networks) ? post.networks : []) as Array<{
    platform?: string;
  }>;
  if (networks.some((n) => n.platform === input.platform)) {
    return { ok: false, error: `Esa pieza ya tiene ${input.platform}.` };
  }

  const { error } = await supabase
    .from("content_posts")
    .update({
      networks: [
        ...networks,
        {
          platform: input.platform,
          planned_at: null,
          options: defaultOptionsFor(input.platform),
          // Vuelve a revision: lo que saldria no es lo que se aprobo.
          needs_review: decision.needsReview,
        },
      ] as never,
      ...(decision.needsReview ? { status: "in_review" } : {}),
    })
    .eq("id", post.id);

  if (error) return { ok: false, error: "No pude agregar la red" };

  revalidatePath(CONTENT_PATH);
  return {
    ok: true,
    data: {
      needsReview: decision.needsReview,
      ...(decision.needsReview ? { reason: decision.reason } : {}),
    },
  };
}

/**
 * Copia una pieza como variante para otra red (F28).
 *
 * `duplicateAsVariant` tampoco la llamaba nadie. Nace en borrador y sin
 * fechas: heredarlas programaria dos piezas para el mismo momento sin que
 * nadie lo haya pedido.
 */
export async function duplicatePostAsVariant(input: {
  postId: string;
}): Promise<ContentActionResult<{ id: string }>> {
  const { workspace, user, supabase } = await contentContext();

  const { data: source } = await supabase
    .from("content_posts")
    .select("id, idea_id, title, format, copy, caption, networks, media")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!source) return { ok: false, error: "No encontre esa pieza" };

  const variant = duplicateAsVariant({
    id: source.id,
    idea_id: source.idea_id,
    title: source.title,
    format: source.format,
    copy: (source.copy ?? {}) as Record<string, unknown>,
    caption: source.caption,
    networks: (Array.isArray(source.networks) ? source.networks : []) as never,
    media: Array.isArray(source.media) ? source.media : [],
  });

  const { data: created, error } = await supabase
    .from("content_posts")
    .insert({
      workspace_id: workspace.id,
      created_by: user.id,
      ...variant,
      networks: variant.networks as never,
      media: variant.media as never,
      copy: variant.copy as never,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    console.error("[content] no pude duplicar la pieza:", error?.message);
    return { ok: false, error: "No pude duplicar la pieza" };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "channel",
    entityId: workspace.id,
    action: "create",
    metadata: { kind: "content_duplicated", from: source.id, to: created.id },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: created.id } };
}
