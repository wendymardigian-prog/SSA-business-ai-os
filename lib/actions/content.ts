"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { validateIdea, type IdeaInput } from "@/lib/content/ideas";
import { checkTaxonomyRefs } from "@/lib/content/classification-refs";
import { cleanClassification, pickInheritedClassification } from "@/lib/content/classification";
import { keepServerFields, normalizeNetworks } from "@/lib/content/networks-schema";
import type { MediaEntry } from "@/lib/content/media";
import { evaluateDrop } from "@/lib/content/board";
import { plannedDateChanges } from "@/lib/content/reschedule";
import { canRedistribute, duplicateAsVariant, type NetworkEntry } from "@/lib/content/redistribution";
import { defaultOptionsFor } from "@/lib/content/network-options";
import { enqueueCopy } from "@/lib/content/copy-queue";
import { readCopywriterConfig } from "@/lib/content/copywriter";
import { createServiceClient } from "@/lib/supabase/server";
import { writeVersion } from "@/lib/content/save-version";
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
    can,
  };
}

// ── Ideas ────────────────────────────────────────────────────────────────

export async function createIdea(input: IdeaInput): Promise<ContentActionResult<{ id: string }>> {
  const checked = validateIdea(input);
  if (!checked.ok) return checked;

  const { workspace, user, supabase } = await contentContext();

  // El pilar y la oferta tienen que ser de este negocio y estar vigentes.
  const refs = await checkTaxonomyRefs(supabase, workspace.id, checked.idea);
  if (!refs.ok) return refs;

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
  const { workspace, user, supabase, can } = await contentContext();
  // `content.approve` y no "ser admin" (F78). "Aprobar y producir copy" pide
  // ademas `content.ai`, y se rechaza ANTES de aprobar: aprobar la idea y
  // dejar el copy sin pedir seria hacer solo la mitad de lo que se apreto.
  if (!can("content.approve")) return { ok: false, error: "No tenes permiso para aprobar ideas" };
  if (options.produceCopy === true && !can("content.ai")) {
    return { ok: false, error: "No tenes permiso para producir copy con IA" };
  }

  const { data: idea, error: readError } = await supabase
    .from("content_ideas")
    .select("id, title, format, status")
    .eq("id", ideaId)
    .maybeSingle();

  if (readError || !idea) return { ok: false, error: "No encontre esa idea" };
  if (idea.status !== "nueva") return { ok: false, error: "Esa idea ya estaba decidida" };

  // La v2 hereda la clasificacion y las redes de la idea (F91); el guion y las
  // notas de grabacion arrancan vacios.
  const { data: postId, error } = await supabase.rpc("approve_content_idea_v2", {
    p_idea_id: ideaId,
    p_title: idea.title,
    p_format: idea.format,
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

/**
 * Edita una idea que todavia esta en la columna Ideas (C3).
 *
 * Solo mientras es `nueva`: una vez aprobada, lo que hay que editar es el
 * post, y cambiar la idea de atras seria reescribir de donde salio algo que
 * ya existe.
 */
export async function updateIdea(
  ideaId: string,
  input: IdeaInput,
): Promise<ContentActionResult> {
  const checked = validateIdea(input);
  if (!checked.ok) return checked;

  const { workspace, user, supabase } = await contentContext();

  const { data: idea } = await supabase
    .from("content_ideas")
    .select("id, status, created_by, pillar_id, offer_id")
    .eq("id", ideaId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!idea) return { ok: false, error: "No encontre esa idea" };
  if (idea.status !== "nueva") {
    return { ok: false, error: "Esa idea ya se decidio: lo que se edita ahora es el post." };
  }

  // Un pilar archivado despues de elegirlo se puede conservar; uno nuevo, no.
  const refs = await checkTaxonomyRefs(supabase, workspace.id, checked.idea, idea);
  if (!refs.ok) return refs;

  const { error } = await supabase
    .from("content_ideas")
    .update(checked.idea)
    .eq("id", ideaId);

  if (error) {
    console.error("[content] no pude editar la idea:", error.message);
    return { ok: false, error: "No pude guardar los cambios" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_idea_updated", idea_id: ideaId },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

export async function discardIdea(
  ideaId: string,
  reason?: string,
): Promise<ContentActionResult> {
  const { workspace, user, supabase, can } = await contentContext();
  if (!can("content.approve")) return { ok: false, error: "No tenes permiso para descartar ideas" };

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
  /** Clasificacion (F91). Si hay idea de origen y no se manda, se hereda de ella. */
  offer_id?: string | null;
  pillar_id?: string | null;
  funnel_stage?: string | null;
  reference?: string | null;
}

export async function createPost(
  input: NewPostInput,
): Promise<ContentActionResult<{ id: string }>> {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "La pieza necesita un titulo" };

  const { workspace, user, supabase } = await contentContext();

  // Una pieza vinculada a una idea hereda su clasificacion (F91), salvo lo que
  // se haya elegido a mano. Las redes no: las elige quien crea la pieza.
  const idea = input.ideaId
    ? (
        await supabase
          .from("content_ideas")
          .select("format, reference, offer_id, pillar_id, funnel_stage")
          .eq("id", input.ideaId)
          .eq("workspace_id", workspace.id)
          .maybeSingle()
      ).data
    : null;

  const own = cleanClassification(input);
  const classification = pickInheritedClassification(idea, {
    format: own.format,
    offer_id: own.offer_id,
    pillar_id: own.pillar_id,
    funnel_stage: own.funnel_stage,
    reference: own.reference,
  });

  const refs = await checkTaxonomyRefs(supabase, workspace.id, classification);
  if (!refs.ok) return refs;

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
      format: classification.format,
      offer_id: classification.offer_id,
      pillar_id: classification.pillar_id,
      funnel_stage: classification.funnel_stage,
      reference: classification.reference,
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

  // Cambiar el estado corta la sesion de edicion (C6): se lleva su propia
  // version, siempre.
  try {
    const service = await createServiceClient();
    await writeVersion(service, {
      postId,
      workspaceId: workspace.id,
      context: { trigger: "status_change" },
      authorId: user.id,
    });
  } catch (err) {
    console.error("[content] no pude registrar la version del cambio de estado:", err);
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
  /** Clasificacion (F91). Solo se escribe lo que viene. */
  offer_id?: string | null;
  pillar_id?: string | null;
  funnel_stage?: string | null;
  reference?: string | null;
  /** El guion (F90). */
  script?: string | null;
  recording_notes?: string | null;
  caption?: string | null;
  networks?: unknown[];
  /** Para detectar que alguien mas lo edito mientras tanto. */
  knownUpdatedAt?: string;
}): Promise<
  ContentActionResult<{ updatedAt: string; staleWarning: boolean; rescheduleWarnings: string[] }>
> {
  const { workspace, user, supabase } = await contentContext();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, updated_at, status, pillar_id, offer_id, media, networks")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  // Las redes son un jsonb: antes se escribian tal cual llegaban. Ahora se
  // valida la forma y los archivos se contrastan con la biblioteca real de la
  // pieza (F92/F93).
  let networks: unknown[] | undefined;
  if (input.networks !== undefined) {
    const checked = normalizeNetworks(
      input.networks,
      (Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[],
    );
    if (!checked.ok) return { ok: false, error: checked.error };
    // Como se publica cada red y lo marcado a mano lo escribe solo el
    // servidor, con su permiso (Contenido v4): se conserva lo guardado.
    networks = keepServerFields(
      checked.networks,
      (Array.isArray(post.networks) ? post.networks : []) as unknown as NetworkEntry[],
    );
  }

  // Gana el ultimo que guarda, pero se avisa: perder el trabajo de otro sin
  // enterarse es peor que tener que copiar y pegar.
  const stale = Boolean(input.knownUpdatedAt && input.knownUpdatedAt !== post.updated_at);

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.format !== undefined) patch.format = input.format;

  const classification = cleanClassification(input);
  if (input.offer_id !== undefined) patch.offer_id = classification.offer_id;
  if (input.pillar_id !== undefined) patch.pillar_id = classification.pillar_id;
  if (input.funnel_stage !== undefined) patch.funnel_stage = classification.funnel_stage;
  if (input.reference !== undefined) patch.reference = classification.reference;

  if (input.offer_id !== undefined || input.pillar_id !== undefined) {
    const refs = await checkTaxonomyRefs(
      supabase,
      workspace.id,
      {
        pillar_id: input.pillar_id !== undefined ? classification.pillar_id : null,
        offer_id: input.offer_id !== undefined ? classification.offer_id : null,
      },
      post,
    );
    if (!refs.ok) return refs;
  }

  if (input.script !== undefined) patch.script = input.script;
  if (input.recording_notes !== undefined) patch.recording_notes = input.recording_notes;
  if (input.caption !== undefined) patch.caption = input.caption;
  if (networks !== undefined) patch.networks = networks;

  // Editar a mano marca el texto como revisado: la advertencia de "generado
  // con IA, revisalo" deja de tener sentido apenas alguien lo toca.
  if (input.script !== undefined || input.recording_notes !== undefined) patch.ai_unreviewed = false;

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
  const rescheduleWarnings = networks
    ? await applyPlannedDateChanges(workspace.id, input.postId, networks)
    : [];

  // La sesion de edicion (Contenido v4, C6): el primer cambio despues de 10
  // minutos crea una version; los siguientes, dentro de la sesion, pisan esa
  // misma fila. Que esto falle no puede tirar abajo un guardado que ya quedo
  // escrito: el historial es un extra, no el dato.
  try {
    const service = await createServiceClient();
    await writeVersion(service, {
      postId: input.postId,
      workspaceId: workspace.id,
      context: { trigger: "edit" },
      authorId: user.id,
    });
  } catch (err) {
    console.error("[content] no pude registrar la version de esta sesion:", err);
  }

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
    .select("id, idea_id, title, format, script, recording_notes, caption, networks, media")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!source) return { ok: false, error: "No encontre esa pieza" };

  const variant = duplicateAsVariant({
    id: source.id,
    idea_id: source.idea_id,
    title: source.title,
    format: source.format,
    script: source.script ?? null,
    recording_notes: source.recording_notes ?? null,
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
