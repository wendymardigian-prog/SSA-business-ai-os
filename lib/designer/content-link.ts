/**
 * El vínculo entre un diseño y una pieza de Contenido (DS8, F62 y F63): el núcleo de las Server Actions de
 * `lib/actions/designer/content.ts`.
 *
 * Recibe el cliente de SERVICIO ya creado, y la persona y el negocio de la SESIÓN (nunca del navegador); escribe siempre
 * filtrando por ese negocio. El permiso (`designer.edit` + `content.create`) y si la persona puede escribir ESA pieza
 * (`canWritePost`: administrador, o quien la creó o la tiene asignada) los chequea la acción ANTES; acá se vuelve a
 * mirar lo de la pieza porque las tablas no tienen políticas de escritura para quien llama. Nunca lanza hacia la
 * pantalla: devuelve un resultado.
 *
 * Qué NO cambia: publicar, programar, el borrado de media publicada a los 30 días y los permisos de Contenido. Esto
 * solo agrega una pieza o una red a una pieza, y vincula; los archivos los arma `design_content_sync`. Desvincular o
 * archivar un diseño nunca borra los archivos de la pieza.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { funnelStageInfo } from "@/lib/content/classification";
import { enqueueCopy } from "@/lib/content/copy-queue";
import type { MediaEntry } from "@/lib/content/media";
import { changeFormat, getFormat } from "@/lib/content/network-format";
import { defaultOptionsFor } from "@/lib/content/network-options";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { STATUS_LABELS } from "@/lib/content/status";
import type { AuditAction, Database } from "@/lib/types/database";
import { contentTarget, pageFit, targetsForDesignFormat, type ContentTarget } from "./content-map";
import { buildPieceRequest, designTextParts, type PieceBrief } from "./content-request";
import { networkLabel } from "./content-pieces";
import type { ContentLinkInfo, DesignFromPieceData, SyncToPieceData, UseInContentData, UseInContentModalData } from "./content-link-types";
import { enqueueContentSync, designGroups, pickTargetForLink, syncDecision } from "./content-sync";
import { loadNetworkStates } from "./content-state";
import type { ActionResult, ContentAiContext, UseInContentInput } from "./contracts";
import { createDesignCore, type CoreEnv, type CreateContext } from "./designs-core";
import { parseDesignDoc, type DesignDoc } from "./doc/schema";
import { isFormatKey, type FormatKey } from "./formats";

type Db = SupabaseClient<Database>;

export interface LinkEnv {
  service: Db;
  actor: { workspaceId: string; userId: string };
  /** Si la persona puede escribir una pieza (administrador, o quien la creó o la tiene asignada). */
  canWritePiece: (piece: { created_by: string | null; assigned_to: string | null }) => boolean;
  /** `content.ai`: puede pedirle el caption al copywriter. */
  canUseAi: boolean;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
export const MAX_TITLE = 200;
const MAX_NETWORKS = 5;
export const NO_WRITE = "Solo podés vincular una pieza que creaste o tenés asignada (o si administrás el contenido).";

/** El link que abre el drawer de una pieza. */
export function pieceHref(postId: string): string {
  return `/dashboard/content?piece=${encodeURIComponent(postId)}`;
}

/** El link del editor que abre el diseño con «← Volver a la pieza». */
export function editorHrefFromPiece(designId: string): string {
  return `/dashboard/disenos/d/${designId}?desde=pieza`;
}

const asNetworks = (value: unknown): NetworkEntry[] => (Array.isArray(value) ? (value as NetworkEntry[]) : []);
const asMedia = (value: unknown): MediaEntry[] => (Array.isArray(value) ? (value as MediaEntry[]) : []);

// ─── Lecturas ────────────────────────────────────────────────────────────────

interface DesignLite {
  id: string;
  name: string;
  format: FormatKey;
  rev: number;
  pages: number;
  /** El documento, si valida (para sacarle el texto). */
  doc: DesignDoc | null;
  content_post_id: string | null;
  content_network: string | null;
  archived: boolean;
  isGeneration: boolean;
}

async function readDesign(env: LinkEnv, designId: string): Promise<DesignLite | null> {
  const { data, error } = await env.service
    .from("designs")
    .select("id, name, format, rev, doc, content_post_id, content_network, archived_at, template_id")
    .eq("id", designId)
    .eq("workspace_id", env.actor.workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[designer-content] no pude leer el diseño:", error.code ?? "error");
    return null;
  }
  if (!data) return null;
  const row = data as unknown as { id: string; name: string; format: string; rev: number; doc: unknown; content_post_id: string | null; content_network: string | null; archived_at: string | null; template_id: string | null };
  const parsed = parseDesignDoc(row.doc);
  return {
    id: row.id,
    name: row.name,
    format: (isFormatKey(row.format) ? row.format : "v45") as FormatKey,
    rev: Number(row.rev) || 0,
    pages: parsed.ok ? parsed.doc.pages.length : 1,
    doc: parsed.ok ? parsed.doc : null,
    content_post_id: row.content_post_id,
    content_network: row.content_network,
    archived: !!row.archived_at,
    isGeneration: !!row.template_id,
  };
}

interface PostLite {
  id: string;
  title: string;
  status: string;
  script: string | null;
  caption: string | null;
  networks: NetworkEntry[];
  media: MediaEntry[];
  created_by: string | null;
  assigned_to: string | null;
  pillar_id: string | null;
  offer_id: string | null;
  funnel_stage: string | null;
  updated_at: string;
  archived_at: string | null;
}

const POST_COLUMNS = "id, title, status, script, caption, networks, media, created_by, assigned_to, pillar_id, offer_id, funnel_stage, updated_at, archived_at";

async function readPost(env: LinkEnv, postId: string): Promise<PostLite | null> {
  const { data, error } = await env.service.from("content_posts").select(POST_COLUMNS).eq("id", postId).eq("workspace_id", env.actor.workspaceId).maybeSingle();
  if (error) {
    console.error("[designer-content] no pude leer la pieza:", error.code ?? "error");
    return null;
  }
  if (!data) return null;
  const row = data as unknown as Omit<PostLite, "networks" | "media"> & { networks: unknown; media: unknown };
  return { ...row, networks: asNetworks(row.networks), media: asMedia(row.media) };
}

/**
 * Cambia las redes o la biblioteca de una pieza sin pisar lo que la persona guardó en el medio: el UPDATE es condicional
 * sobre `updated_at`; si cambió, se vuelve a leer y a armar (hasta 3 veces). `build` devuelve null cuando no hay nada que cambiar.
 */
async function mutatePost(env: LinkEnv, postId: string, build: (post: PostLite) => { networks?: NetworkEntry[]; media?: MediaEntry[] } | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const post = await readPost(env, postId);
    if (!post) return false;
    const patch = build(post);
    if (!patch) return true;
    const { data, error } = await env.service
      .from("content_posts")
      .update({ ...(patch.networks ? { networks: patch.networks as never } : {}), ...(patch.media ? { media: patch.media as never } : {}) })
      .eq("id", postId)
      .eq("workspace_id", env.actor.workspaceId)
      .eq("updated_at", post.updated_at)
      .select("id");
    if (error) {
      console.error("[designer-content] no pude actualizar la pieza:", error.code ?? "error");
      return false;
    }
    if (data && data.length > 0) return true;
  }
  return false;
}

const audit = (env: LinkEnv, designId: string, action: AuditAction, metadata: Record<string, string | number | boolean | null>) =>
  logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: "design", entityId: designId, action, metadata, performedBy: env.actor.userId });

/** Vincula el diseño con la pieza y la red. Los otros diseños de ESA red de ESA pieza se desvinculan (sus archivos quedan). */
async function linkDesign(env: LinkEnv, design: DesignLite, postId: string, platform: string, via: "new" | "link" | "piece"): Promise<{ ok: true; replaced: string[] } | { ok: false; error: string }> {
  const { data: others } = await env.service
    .from("designs")
    .select("id, name")
    .eq("workspace_id", env.actor.workspaceId)
    .eq("content_post_id", postId)
    .eq("content_network", platform);
  const replaced: string[] = [];
  for (const other of (others ?? []) as Array<{ id: string; name: string }>) {
    if (other.id === design.id) continue;
    const { error } = await env.service.from("designs").update({ content_post_id: null, content_network: null } as never).eq("id", other.id).eq("workspace_id", env.actor.workspaceId);
    if (error) return fail("No pude cambiar el diseño que ya usaba esa red. Probá de nuevo.");
    await audit(env, other.id, "design.content_unlinked", { post_id: postId, network: platform, reason: "replaced" });
    replaced.push(other.name);
  }
  const { error } = await env.service.from("designs").update({ content_post_id: postId, content_network: platform } as never).eq("id", design.id).eq("workspace_id", env.actor.workspaceId);
  if (error) {
    console.error("[designer-content] no pude vincular:", error.code ?? "error");
    return fail("No pude vincular el diseño con la pieza. Probá de nuevo.");
  }
  await audit(env, design.id, "design.content_linked", { post_id: postId, network: platform, via });
  return { ok: true, replaced };
}

/** La red con su formato de Contenido y, si el formato ya tiene archivos que sirvan, los suyos. */
function networkEntryFor(platform: string, target: ContentTarget): NetworkEntry {
  const base: NetworkEntry = { platform, planned_at: null, options: defaultOptionsFor(platform) };
  return changeFormat(base, target.format, []);
}

// ─── F63: «Usar en contenido» ────────────────────────────────────────────────

export interface LinkToContentDeps {
  enqueue?: typeof enqueueContentSync;
  enqueueCopy?: typeof enqueueCopy;
}

/**
 * Crea una pieza nueva (en Borrador) o vincula una existente y encola `design_content_sync`. La pieza nueva nace con las
 * redes elegidas (cada una con su formato de Contenido, sin fecha), y los archivos llegan cuando corre el job: quedan
 * en su biblioteca y elegidos en orden en cada red.
 */
export async function linkToContentCore(env: LinkEnv, input: UseInContentInput, deps: LinkToContentDeps = {}): Promise<ActionResult<UseInContentData>> {
  const design = await readDesign(env, input.designId);
  if (!design) return fail("No encontramos este diseño.");
  if (design.isGeneration) return fail("Una pieza emitida desde una plantilla no se usa en contenido.");
  if (design.archived) return fail("El diseño está archivado: restauralo para usarlo en contenido.");
  if (targetsForDesignFormat(design.format).length === 0) return fail("Este formato de diseño no se publica en redes.");
  const enqueue = deps.enqueue ?? enqueueContentSync;

  if (input.mode === "new") {
    const title = (input.title ?? "").replace(/\s+/g, " ").trim() || design.name;
    if (title.length > MAX_TITLE) return fail(`El título va de 1 a ${MAX_TITLE} caracteres.`);
    if (!Array.isArray(input.networks) || input.networks.length === 0) return fail("Elegí al menos una red.");
    if (input.networks.length > MAX_NETWORKS) return fail(`Una pieza tiene hasta ${MAX_NETWORKS} redes.`);

    const picked: Array<{ platform: string; target: ContentTarget }> = [];
    for (const item of input.networks) {
      const target = contentTarget(String(item?.platform ?? ""), String(item?.format ?? ""));
      if (!target || !target.designFormats.includes(design.format)) return fail("Una de las redes elegidas no sirve para este diseño.");
      if (picked.some((p) => p.platform === target.platform)) return fail("Elegí una sola publicación por red.");
      picked.push({ platform: target.platform, target });
    }

    const { data: last } = await env.service
      .from("content_posts")
      .select("position")
      .eq("workspace_id", env.actor.workspaceId)
      .eq("status", "draft")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Con «Que el copywriter proponga el caption», le damos de qué partir: el texto del diseño, página por página.
    const seeded = input.proposeCaption && env.canUseAi && design.doc ? designTextParts(design.doc).join("\n\n") : "";
    const first = picked[0].target;
    const { data: created, error } = await env.service
      .from("content_posts")
      .insert({
        workspace_id: env.actor.workspaceId,
        title,
        format: getFormat(first.platform, first.format)?.label ?? null,
        networks: picked.map((p) => networkEntryFor(p.platform, p.target)) as never,
        ...(seeded ? { script: seeded } : {}),
        created_by: env.actor.userId,
        position: ((last as { position?: number } | null)?.position ?? 0) + 10,
      } as never)
      .select("id")
      .single();
    if (error || !created) {
      console.error("[designer-content] no pude crear la pieza:", error?.code ?? "sin fila");
      return fail("No pude crear la pieza. Probá de nuevo.");
    }
    const postId = (created as { id: string }).id;

    const linked = await linkDesign(env, design, postId, picked[0].platform, "new");
    if (!linked.ok) return linked;
    await enqueue(env.service, { designId: design.id, networks: picked.slice(1).map((p) => p.platform) });

    let notice: string | undefined;
    if (input.proposeCaption) {
      if (!env.canUseAi) notice = "La pieza quedó creada sin caption: pedirle el caption al copywriter necesita el permiso de contenido con IA.";
      else {
        const queued = await (deps.enqueueCopy ?? enqueueCopy)(env.service, { workspaceId: env.actor.workspaceId, postId });
        if (!queued.ok) notice = `La pieza quedó creada, pero el copywriter no pudo empezar: ${queued.error}`;
      }
    }
    return { ok: true, data: { postId, href: pieceHref(postId), ...(notice ? { notice } : {}) } };
  }

  // Vincular a una pieza existente.
  const post = await readPost(env, input.postId);
  if (!post) return fail("No encontramos esa pieza.");
  if (post.archived_at) return fail("Esa pieza está archivada.");
  if (!env.canWritePiece(post)) return fail(NO_WRITE);

  const existing = post.networks.find((n) => n.platform === input.platform);
  const target = pickTargetForLink({ platform: input.platform, designFormat: design.format, pageCount: design.pages, existingFormat: existing?.format ?? null });
  if (!target) return fail("Este diseño no sirve para esa red.");

  // La red se suma a la pieza (o toma el formato de la publicación) solo si todavía no sale: lo programado o publicado no se retoca.
  const states = await loadNetworkStates(env.service, { postId: post.id, workspaceId: env.actor.workspaceId, networks: post.networks });
  const state = states.get(target.platform);
  const wrote = await mutatePost(env, post.id, (fresh) => {
    const current = fresh.networks.find((n) => n.platform === target.platform);
    if (!current) return { networks: [...fresh.networks, networkEntryFor(target.platform, target)] };
    if (current.format === target.format) return null;
    if (state && syncDecision(state.id) !== "update") return null;
    return { networks: fresh.networks.map((n) => (n.platform === target.platform ? { ...n, format: target.format } : n)) };
  });
  if (!wrote) return fail("No pude sumar la red a la pieza. Probá de nuevo.");

  const linked = await linkDesign(env, design, post.id, target.platform, "link");
  if (!linked.ok) return linked;
  await enqueue(env.service, { designId: design.id });
  const notice = linked.replaced.length > 0 ? `${networkLabel({ platform: target.platform, format: target.format })} ya usaba ${linked.replaced.map((n) => `«${n}»`).join(", ")}: ahora usa este diseño (los archivos anteriores quedan en la pieza).` : undefined;
  return { ok: true, data: { postId: post.id, href: pieceHref(post.id), ...(notice ? { notice } : {}) } };
}

// ─── F62: «✦ Diseñar con el Diseñador IA» desde la pieza ────────────────────

export interface DesignFromPieceDeps {
  startAi: (input: { kind: "design"; id: string; prompt: string; style: null; attachments: []; multiPage: boolean; contentContext: ContentAiContext }) => Promise<ActionResult<unknown>>;
  enqueue?: typeof enqueueContentSync;
}

/**
 * Crea el diseño con el formato de la red (F61), lo vincula a la pieza (`content_post_id`, `content_network`) y le arma
 * el pedido a la IA con el guion (en un carrusel, cada parte es una página), el caption, el pilar, la oferta y la etapa.
 * El diseño queda creado aunque la IA no pueda arrancar: el editor lo muestra con su aviso.
 */
export async function designFromPieceCore(env: LinkEnv, ctx: CreateContext, input: { postId: string; platform: string }, deps: DesignFromPieceDeps): Promise<ActionResult<DesignFromPieceData>> {
  const post = await readPost(env, input.postId);
  if (!post) return fail("No encontramos esa pieza.");
  if (post.archived_at) return fail("Esa pieza está archivada.");
  if (!env.canWritePiece(post)) return fail(NO_WRITE);

  const [pillar, offer] = await Promise.all([
    post.pillar_id ? env.service.from("content_pillars").select("name").eq("id", post.pillar_id).eq("workspace_id", env.actor.workspaceId).maybeSingle() : Promise.resolve({ data: null }),
    post.offer_id ? env.service.from("products").select("name").eq("id", post.offer_id).eq("workspace_id", env.actor.workspaceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const brief: PieceBrief = {
    postId: post.id,
    title: post.title,
    script: post.script,
    caption: post.caption,
    pillar: (pillar.data as { name?: string } | null)?.name ?? null,
    offer: (offer.data as { name?: string } | null)?.name ?? null,
    funnelStage: funnelStageInfo(post.funnel_stage) ? post.funnel_stage : null,
  };
  const existing = post.networks.find((n) => n.platform === input.platform);
  const request = buildPieceRequest({ piece: brief, platform: input.platform, existingFormat: existing?.format ?? null });
  if (!request.ok) return fail(request.error);

  const created = await createDesignCore(
    { service: env.service, actor: env.actor } satisfies CoreEnv,
    { kind: "design", origin: "ai", format: request.format, multiPage: request.multiPage, name: request.name, prompt: request.prompt, contentContext: request.contentContext },
    ctx,
  );
  if (!created.ok) return fail(created.error);
  const designId = created.data.id;

  // La red entra en la pieza con su formato si todavía no estaba; si ya estaba y sale (programada o publicada) no se retoca.
  const states = await loadNetworkStates(env.service, { postId: post.id, workspaceId: env.actor.workspaceId, networks: post.networks });
  const state = states.get(request.target.platform);
  await mutatePost(env, post.id, (fresh) => {
    const current = fresh.networks.find((n) => n.platform === request.target.platform);
    if (!current) return { networks: [...fresh.networks, networkEntryFor(request.target.platform, request.target)] };
    if (current.format === request.target.format) return null;
    if (state && syncDecision(state.id) !== "update") return null;
    return { networks: fresh.networks.map((n) => (n.platform === request.target.platform ? { ...n, format: request.target.format } : n)) };
  });

  const design = (await readDesign(env, designId)) as DesignLite;
  const linked = await linkDesign(env, design, post.id, request.target.platform, "piece");
  if (!linked.ok) return linked;

  const asked = await deps.startAi({ kind: "design", id: designId, prompt: request.prompt, style: null, attachments: [], multiPage: request.multiPage, contentContext: request.contentContext });
  const notice = asked.ok ? undefined : /todav[ií]a no est[aá] construid/i.test(asked.error) ? "La IA todavía no está disponible: el diseño quedó creado y vinculado a la pieza." : asked.error;
  return { ok: true, data: { designId, href: editorHrefFromPiece(designId), ...(notice ? { notice } : {}) } };
}

// ─── F64: enviar los cambios, desvincular, «Dejar como está» ─────────────────

/** Qué redes de la pieza recibirían los archivos del diseño (la principal y las que ya apuntan a ellos). */
function targetPlatforms(design: DesignLite, post: PostLite): string[] {
  const own = new Set<string>(design.content_network ? [design.content_network] : []);
  for (const network of post.networks) if ((network.files ?? []).some((id) => id.startsWith(`design-${design.id}-`))) own.add(network.platform);
  return [...own].filter((platform) => post.networks.some((n) => n.platform === platform));
}

/**
 * «Enviar los cambios a la pieza» / «Actualizar los archivos». Sin `force`, una pieza programada no se toca: se pide
 * confirmar en la pieza. Con `force`, lo programado (o fallido) se actualiza; lo publicado, nunca.
 */
export async function syncToPieceCore(env: LinkEnv, input: { designId: string; force?: boolean }, deps: { enqueue?: typeof enqueueContentSync } = {}): Promise<ActionResult<SyncToPieceData>> {
  const design = await readDesign(env, input.designId);
  if (!design) return fail("No encontramos este diseño.");
  if (!design.content_post_id) return fail("Este diseño no está vinculado a una pieza.");
  if (design.archived) return fail("El diseño está archivado: restauralo para enviar los cambios.");
  const post = await readPost(env, design.content_post_id);
  if (!post) return fail("La pieza vinculada ya no existe.");
  if (!env.canWritePiece(post)) return fail(NO_WRITE);

  const states = await loadNetworkStates(env.service, { postId: post.id, workspaceId: env.actor.workspaceId, networks: post.networks });
  const platforms = targetPlatforms(design, post);
  const decisions = platforms.map((p) => (states.get(p) ? syncDecision(states.get(p)!.id) : "skip"));
  const href = pieceHref(post.id);
  if (decisions.length > 0 && decisions.every((d) => d === "skip")) return { ok: true, data: { queued: false, published: true, href } };
  if (!input.force && decisions.includes("notify") && !decisions.includes("update")) return { ok: true, data: { queued: false, needsConfirmation: true, href } };

  const result = await (deps.enqueue ?? enqueueContentSync)(env.service, { designId: design.id, ...(input.force ? { force: true } : {}) });
  return { ok: true, data: { queued: result.queued, href } };
}

/** Desvincular: el diseño deja de sincronizar y los archivos que ya estaban quedan en la pieza (F66). */
export async function unlinkCore(env: LinkEnv, input: { designId: string }): Promise<ActionResult> {
  const design = await readDesign(env, input.designId);
  if (!design) return fail("No encontramos este diseño.");
  if (!design.content_post_id) return { ok: true, data: undefined };
  const post = await readPost(env, design.content_post_id);
  // Una pieza que ya no existe no frena desvincular; una que existe pide poder escribirla.
  if (post && !env.canWritePiece(post)) return fail(NO_WRITE);
  const { error } = await env.service.from("designs").update({ content_post_id: null, content_network: null } as never).eq("id", design.id).eq("workspace_id", env.actor.workspaceId);
  if (error) {
    console.error("[designer-content] no pude desvincular:", error.code ?? "error");
    return fail("No pude desvincular el diseño. Probá de nuevo.");
  }
  await audit(env, design.id, "design.content_unlinked", { post_id: design.content_post_id, network: design.content_network, reason: "manual" });
  return { ok: true, data: undefined };
}

/**
 * «Dejar como está»: la pieza queda con los archivos que tiene y el aviso se va hasta el próximo cambio del diseño. Los
 * archivos del diseño pasan a decir que son de la versión actual (no se toca ningún archivo ni ninguna red).
 */
export async function keepPieceFilesCore(env: LinkEnv, input: { designId: string }): Promise<ActionResult> {
  const design = await readDesign(env, input.designId);
  if (!design) return fail("No encontramos este diseño.");
  if (!design.content_post_id) return { ok: true, data: undefined };
  const postId = design.content_post_id;
  const post = await readPost(env, postId);
  if (!post) return fail("La pieza vinculada ya no existe.");
  if (!env.canWritePiece(post)) return fail(NO_WRITE);
  const ok = await mutatePost(env, postId, (fresh) => {
    let changed = false;
    const media = fresh.media.map((m) => {
      if (m.design_id !== design.id || m.design_version === design.rev) return m;
      changed = true;
      return { ...m, design_version: design.rev };
    });
    return changed ? { media } : null;
  });
  return ok ? { ok: true, data: undefined } : fail("No pude guardar la decisión. Probá de nuevo.");
}

// ─── Lecturas para el modal y el menú ────────────────────────────────────────

/** A qué pieza está vinculado un diseño (el menú «En contenido ▾»). Null si no lo está o la pieza ya no existe. */
export async function describeLink(env: LinkEnv, designId: string): Promise<ContentLinkInfo | null> {
  const design = await readDesign(env, designId);
  if (!design?.content_post_id) return null;
  const post = await readPost(env, design.content_post_id);
  if (!post) return null;
  const states = await loadNetworkStates(env.service, { postId: post.id, workspaceId: env.actor.workspaceId, networks: post.networks });
  return {
    postId: post.id,
    title: post.title,
    statusLabel: STATUS_LABELS[post.status as keyof typeof STATUS_LABELS] ?? post.status,
    network: design.content_network,
    href: pieceHref(post.id),
    networks: post.networks.map((n) => ({ platform: n.platform, label: networkLabel(n), state: states.get(n.platform)?.id ?? "none", stateLabel: states.get(n.platform)?.label ?? "Sin fecha" })),
  };
}

/** Lo que dibuja el modal «Usar en contenido». */
export async function loadModalData(env: LinkEnv, designId: string): Promise<ActionResult<UseInContentModalData>> {
  const design = await readDesign(env, designId);
  if (!design) return fail("No encontramos este diseño.");
  const networks = targetsForDesignFormat(design.format).map((t) => ({ platform: t.platform, format: t.format, label: t.label, fit: pageFit(t, design.pages), note: t.note ?? null }));
  return { ok: true, data: { designName: design.name, format: design.format, pageCount: design.pages, networks, canCopy: env.canUseAi, linked: await describeLink(env, designId) } };
}

/** Los diseños de una pieza que usa el drawer: los vinculados a ella y los de los archivos que tiene en su biblioteca. */
export async function loadPieceDesigns(db: Db, params: { workspaceId: string; postId: string; media: MediaEntry[] }): Promise<Array<{ id: string; name: string; rev: number; content_post_id: string | null; content_network: string | null; archived: boolean }>> {
  const fromMedia = designGroups(params.media).map((g) => g.designId);
  const [linked, byId] = await Promise.all([
    db.from("designs").select("id, name, rev, content_post_id, content_network, archived_at").eq("workspace_id", params.workspaceId).eq("content_post_id", params.postId),
    fromMedia.length > 0 ? db.from("designs").select("id, name, rev, content_post_id, content_network, archived_at").eq("workspace_id", params.workspaceId).in("id", fromMedia) : Promise.resolve({ data: [], error: null }),
  ]);
  const seen = new Map<string, { id: string; name: string; rev: number; content_post_id: string | null; content_network: string | null; archived: boolean }>();
  for (const row of [...(linked.data ?? []), ...(byId.data ?? [])] as Array<{ id: string; name: string; rev: number; content_post_id: string | null; content_network: string | null; archived_at: string | null }>) {
    seen.set(row.id, { id: row.id, name: row.name, rev: row.rev, content_post_id: row.content_post_id, content_network: row.content_network, archived: !!row.archived_at });
  }
  return [...seen.values()];
}
