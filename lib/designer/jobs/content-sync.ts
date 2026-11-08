/**
 * El job `design_content_sync`: sincronizar los archivos de un diseño con su pieza de Contenido (DS8, F64).
 *
 * Renderiza el diseño (un PNG por página al tamaño del diseño, ×1; un PDF con todas las páginas para el carrusel PDF
 * de LinkedIn), sube los archivos al bucket de Contenido (`content-media`, `<negocio>/<pieza>/<archivo>`, igual que
 * `lib/actions/content-media.ts`), anota cada uno en `content_posts.media` con su id ESTABLE (`design-<diseño>-<n>` o
 * `design-<diseño>-pdf`) y los campos `design_id`, `design_version` y `design_page`, y deja `networks[].files` de esa
 * red con esos ids en orden. Qué redes se actualizan lo decide `syncDecision` por el estado de CADA red:
 * sin fecha o tentativa → se actualiza; programada o fallida → solo se avisa (salvo `force`); publicada → nunca.
 *
 * La validación de formato de Contenido (`checkFormatFiles`, y `validateNetwork` para lo programado en Zernio) corre
 * sobre el resultado: un carrusel con una sola página queda con su aviso y no se programa. Una red programada en
 * Zernio que se actualiza con `force` se valida ANTES de escribir y se le reenvía la versión nueva (`planContentResync`
 * y `applyContentResync`, los mismos de agregar o sacar un archivo).
 *
 * NUNCA lanza por un fallo de un proveedor (la cola reintentaría a los 10 s encima de la espera propia): el servicio de
 * render que falla de forma pasajera se reagenda a 1, 5 y 15 minutos con `scheduleJob`; sin el servicio configurado
 * queda «Falta conectar el servicio de render» y se reintenta con el próximo guardado o con «Enviar los cambios».
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_MEDIA, removalPlan, type MediaEntry } from "@/lib/content/media";
import { ensureMediaIds, idOf, removeFileFromNetworks } from "@/lib/content/media-library";
import { checkFormatFiles, getFormat } from "@/lib/content/network-format";
import { parseNewMediaEntry } from "@/lib/content/networks-schema";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { resolveNetworkContent } from "@/lib/content/redistribution";
import { applyContentResync, planContentResync } from "@/lib/publishing/content-resync";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";
import { contentTarget, filePlan, outputSize, pageFit, type ContentOutput, type ContentTarget } from "../content-map";
import {
  CONTENT_SYNC_RETRY_MS,
  DESIGN_CONTENT_SYNC_JOB,
  contentSyncKey,
  designFileId,
  designFileIds,
  designFileName,
  isDesignFileId,
  syncDecisionWithForce,
  type ContentSyncPayload,
  type SyncAction,
} from "../content-sync";
import { loadNetworkStates, StateReadError } from "../content-state";
import { parseDesignDoc, type DesignDoc } from "../doc/schema";
import { renderPageHTML } from "../render/page-html";
import { renderDesign, RenderFailed, renderErrorMessage, RenderNotConfigured, type RenderRequest, type RenderResult } from "../render-client";
import { parseDesignSettings } from "../settings-schema";
import { assetUrlFrom, collectAssetPaths, pathBelongsTo, signAssetUrls } from "../storage";

export { DESIGN_CONTENT_SYNC_JOB };

type Db = SupabaseClient<Database>;

/** El bucket de Contenido (el de `lib/actions/content-media.ts`). */
export const CONTENT_MEDIA_BUCKET = "content-media";

export interface ContentSyncDeps {
  render?: (req: RenderRequest) => Promise<RenderResult>;
  now?: () => Date;
  schedule?: typeof scheduleJob;
}

export interface HeldNetwork {
  platform: string;
  /** `notify` = el aviso «El diseño cambió»; `skip` = no se toca. */
  action: Exclude<SyncAction, "update">;
  reason: "scheduled" | "failed" | "published" | "format" | "format_mismatch";
}

export type ContentSyncOutcome =
  | { status: "synced"; networks: string[]; held: HeldNetwork[]; files: string[]; warnings: string[] }
  | { status: "noop"; held: HeldNetwork[] }
  | { status: "skipped"; reason: "bad_payload" | "read_failed" | "not_found" | "not_linked" | "archived" | "post_missing" | "network_missing" }
  | { status: "retry"; attempt: number; at: string; error: string }
  | { status: "failed"; error: string };

const asNetworks = (value: unknown): NetworkEntry[] => (Array.isArray(value) ? (value as NetworkEntry[]) : []);
const asMedia = (value: unknown): MediaEntry[] => (Array.isArray(value) ? (value as MediaEntry[]) : []);

function parsePayload(raw: Record<string, unknown>): ContentSyncPayload | null {
  if (typeof raw.designId !== "string" || raw.designId === "") return null;
  return {
    designId: raw.designId,
    force: raw.force === true,
    networks: Array.isArray(raw.networks) ? raw.networks.filter((n): n is string => typeof n === "string") : [],
    retry: typeof raw.retry === "number" && Number.isFinite(raw.retry) ? Math.max(0, Math.floor(raw.retry)) : 0,
  };
}

interface DesignRow {
  id: string;
  workspace_id: string;
  name: string;
  doc: unknown;
  rev: number;
  content_post_id: string | null;
  content_network: string | null;
  archived_at: string | null;
  template_id: string | null;
}

interface PostRow {
  id: string;
  workspace_id: string;
  caption: string | null;
  media: unknown;
  networks: unknown;
  status: string;
  updated_at: string;
}

const POST_COLUMNS = "id, workspace_id, caption, media, networks, status, updated_at";

async function readPost(db: Db, postId: string, workspaceId: string): Promise<PostRow | null> {
  const { data, error } = await db.from("content_posts").select(POST_COLUMNS).eq("id", postId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new RenderFailed(`No se pudo leer la pieza (${error.message}).`, { retryable: true });
  return (data as unknown as PostRow | null) ?? null;
}

/** El estado de cada red de la pieza (el mismo cálculo del drawer). Una lectura que falla se reintenta: no se decide a ciegas. */
async function networkStates(db: Db, post: PostRow, workspaceId: string) {
  try {
    return await loadNetworkStates(db, { postId: post.id, workspaceId, networks: asNetworks(post.networks) });
  } catch (error) {
    if (error instanceof StateReadError) throw new RenderFailed(error.message, { retryable: true });
    throw error;
  }
}

/** Arma el HTML de cada página con los archivos firmados (igual que `design_render`). */
async function pagesHtml(db: Db, workspaceId: string, doc: DesignDoc): Promise<string[]> {
  const { data: ws } = await db.from("workspaces").select("design_settings").eq("id", workspaceId).maybeSingle();
  const settings = parseDesignSettings((ws as { design_settings?: unknown } | null)?.design_settings ?? {}, workspaceId);
  const uploadedFonts = settings.ok ? (settings.settings.fonts?.uploaded ?? []) : [];
  const paths = collectAssetPaths(doc, uploadedFonts);
  const signed = await signAssetUrls(db, workspaceId, paths);
  // Un archivo del negocio sin su link firmado saldría vacío: no se da por bueno, se reintenta.
  const missing = paths.filter((p) => pathBelongsTo(p, workspaceId) && !signed.has(p));
  if (missing.length > 0) {
    throw new RenderFailed("No se pudieron firmar los links de las imágenes", { retryable: true, userMessage: "No se pudieron preparar las imágenes del diseño. Se vuelve a intentar solo." });
  }
  const assetUrl = assetUrlFrom(signed);
  return doc.pages.map((_p, i) => renderPageHTML(doc, i, { mode: "export", values: {}, assetUrl, uploadedFonts }));
}

interface Rendered {
  id: string;
  fileName: string;
  output: ContentOutput;
  /** 1 = la primera; null en el PDF. */
  page: number | null;
  bytes: Uint8Array;
  contentType: "image/png" | "application/pdf";
}

async function renderOutputs(deps: Required<ContentSyncDeps>, design: DesignRow, doc: DesignDoc, html: string[], outputs: ReadonlySet<ContentOutput>): Promise<Rendered[]> {
  const size = outputSize(doc.format);
  const base = { width: size.width, height: size.height, scale: 1 as const };
  const files: Rendered[] = [];
  if (outputs.has("png")) {
    const res = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "png" });
    const sorted = [...res.files].sort((a, b) => a.page - b.page);
    if (sorted.length !== html.length) throw new RenderFailed("El servicio de render devolvió menos páginas de las pedidas.", { retryable: true });
    sorted.forEach((file, i) => {
      files.push({ id: designFileId(design.id, "png", i + 1), fileName: designFileName(design.id, "png", i + 1), output: "png", page: i + 1, bytes: file.bytes, contentType: "image/png" });
    });
  }
  if (outputs.has("pdf")) {
    const res = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "pdf" });
    const file = res.files[0];
    if (!file) throw new RenderFailed("El servicio de render no devolvió el PDF.", { retryable: true });
    files.push({ id: designFileId(design.id, "pdf"), fileName: designFileName(design.id, "pdf"), output: "pdf", page: null, bytes: file.bytes, contentType: "application/pdf" });
  }
  return files;
}

/** La entrada de la biblioteca de un archivo renderizado (la arma el servidor con `parseNewMediaEntry`). */
function entryFor(design: DesignRow, doc: DesignDoc, post: PostRow, file: Rendered, existing: MediaEntry | undefined): MediaEntry | null {
  const path = `${post.workspace_id}/${post.id}/${file.fileName}`;
  const size = outputSize(doc.format);
  const parsed = parseNewMediaEntry({
    path,
    mime: file.contentType,
    kind: file.output === "pdf" ? "document" : "image",
    sizeBytes: file.bytes.length,
    name: file.output === "pdf" ? `${design.name}.pdf` : `${design.name} · página ${file.page}`,
    width: file.output === "pdf" ? null : size.width,
    height: file.output === "pdf" ? null : size.height,
  });
  if (!parsed.ok) {
    console.error("[design_content_sync] no pude armar la entrada de la biblioteca:", parsed.error);
    return null;
  }
  const kind = ALLOWED_MEDIA[file.contentType].kind;
  return {
    // Lo que la persona ya tenía en el archivo (portada, texto alternativo) se conserva.
    ...(existing ?? {}),
    ...parsed.entry,
    kind,
    is_cover: existing?.is_cover ?? false,
    alt_text: existing?.alt_text ?? null,
    deleted_at: null,
    design_id: design.id,
    design_version: design.rev,
    design_page: file.page,
  };
}

interface Update {
  platform: string;
  target: ContentTarget;
  files: string[];
}

/** El estado nuevo de la pieza: la biblioteca con los archivos del diseño y las redes actualizadas apuntando a ellos. */
export function applyDesignFiles(params: {
  designId: string;
  media: MediaEntry[];
  networks: NetworkEntry[];
  entries: MediaEntry[];
  updates: Update[];
  /** Si hay que borrar del bucket lo que sobra (la pieza no se publicó). */
  postPublished: boolean;
  /** Las páginas PNG que ya no existen, de las que se pueden sacar. */
  stalePages: boolean;
}): { media: MediaEntry[]; networks: NetworkEntry[]; deleteFromBucket: string[] } {
  type WithId = MediaEntry & { id: string };
  const byId = new Map((params.entries as WithId[]).map((e) => [e.id, e]));
  const library = ensureMediaIds(params.media);
  const updated: WithId[] = library.map((m) => byId.get(m.id) ?? m);
  for (const entry of params.entries as WithId[]) if (!library.some((m) => m.id === entry.id)) updated.push(entry);

  const updatePlatforms = new Set(params.updates.map((u) => u.platform));
  let networks = params.networks.map((n) => {
    const update = params.updates.find((u) => u.platform === n.platform);
    return update ? { ...n, files: update.files } : n;
  });

  // Las páginas que el diseño ya no tiene (pasó de 5 a 3): se sacan de la biblioteca, salvo las que usa una red que NO se
  // actualiza (una programada o publicada no pierde un archivo sola).
  let media: MediaEntry[] = updated;
  const deleteFromBucket: string[] = [];
  if (params.stalePages) {
    const keep = new Set(params.entries.map((e) => e.id as string));
    const stale = updated.filter((m) => !m.deleted_at && isDesignFileId(m.id, params.designId) && m.design_id === params.designId && typeof m.design_page === "number" && !keep.has(m.id));
    for (const entry of stale) {
      const usedByOthers = networks.some((n) => !updatePlatforms.has(n.platform) && Array.isArray(n.files) && n.files.includes(entry.id));
      if (usedByOthers) continue;
      const plan = removalPlan({ media, storagePath: entry.storage_path, postPublished: params.postPublished });
      media = plan.media;
      if (plan.deleteFromBucket) deleteFromBucket.push(entry.storage_path);
      networks = removeFileFromNetworks(networks, entry.id).networks;
    }
  }
  return { media, networks, deleteFromBucket };
}

/** Corre una sincronización. Recibe todo por parámetro: se prueba con un cliente y un servicio simulados. */
export async function runContentSync(db: Db, rawPayload: Record<string, unknown>, depsIn: ContentSyncDeps = {}): Promise<ContentSyncOutcome> {
  const deps: Required<ContentSyncDeps> = { render: depsIn.render ?? ((r) => renderDesign(r)), now: depsIn.now ?? (() => new Date()), schedule: depsIn.schedule ?? scheduleJob };
  const payload = parsePayload(rawPayload);
  if (!payload) return { status: "skipped", reason: "bad_payload" };

  try {
    const { data, error } = await db
      .from("designs")
      .select("id, workspace_id, name, doc, rev, content_post_id, content_network, archived_at, template_id")
      .eq("id", payload.designId)
      .maybeSingle();
    if (error) throw new RenderFailed(`No se pudo leer el diseño (${error.message}).`, { retryable: true });
    if (!data) return { status: "skipped", reason: "not_found" };
    const design = data as unknown as DesignRow;
    if (design.template_id || !design.content_post_id) return { status: "skipped", reason: "not_linked" };
    // Archivar un diseño no toca los archivos de la pieza: simplemente deja de sincronizar.
    if (design.archived_at) return { status: "skipped", reason: "archived" };

    const parsed = parseDesignDoc(design.doc);
    if (!parsed.ok) return { status: "failed", error: "El documento del diseño no es válido." };
    const doc = parsed.doc;

    const post = await readPost(db, design.content_post_id, design.workspace_id);
    if (!post) return { status: "skipped", reason: "post_missing" };
    const networks = asNetworks(post.networks);
    const library = ensureMediaIds(asMedia(post.media));

    // Las redes que reciben este diseño: la principal, las que se pidieron al crear la pieza y las que ya apuntan a sus archivos.
    const platforms = new Set<string>();
    if (design.content_network) platforms.add(design.content_network);
    for (const platform of payload.networks ?? []) platforms.add(platform);
    for (const network of networks) if ((network.files ?? []).some((id) => isDesignFileId(id, design.id))) platforms.add(network.platform);
    const present = [...platforms].filter((platform) => networks.some((n) => n.platform === platform));
    if (present.length === 0) return { status: "skipped", reason: "network_missing" };

    const states = await networkStates(db, post, design.workspace_id);
    const held: HeldNetwork[] = [];
    const updates: Update[] = [];
    const pages = doc.pages.length;
    for (const platform of present) {
      const network = networks.find((n) => n.platform === platform) as NetworkEntry;
      const state = states.get(platform);
      const target = contentTarget(platform, network.format ?? null);
      if (!state || !target) {
        // La persona cambió el formato de la red a uno que no se arma con un diseño (un Reel): sus archivos quedan como están.
        held.push({ platform, action: "skip", reason: "format" });
        continue;
      }
      if (!target.designFormats.includes(doc.format)) {
        held.push({ platform, action: "skip", reason: "format_mismatch" });
        continue;
      }
      const action = syncDecisionWithForce(state.id, payload.force === true);
      if (action === "update") {
        updates.push({ platform, target, files: designFileIds(design.id, filePlan(target, pages)) });
      } else {
        held.push({ platform, action, reason: state.id === "pub" ? "published" : state.id === "fail" ? "failed" : "scheduled" });
      }
    }
    if (updates.length === 0) return { status: "noop", held };

    // 1) Renderizar (todavía no se escribe nada).
    const html = await pagesHtml(db, design.workspace_id, doc);
    const outputs = new Set<ContentOutput>(updates.map((u) => u.target.output));
    const rendered = await renderOutputs(deps, design, doc, html, outputs);

    // 2) La pieza nueva, con la validación de Contenido corriendo sobre el resultado.
    let current = post;
    let next = buildState(design, doc, current, rendered, updates, outputs);
    const resync = await planContentResync(db, {
      postId: post.id,
      before: { caption: post.caption, media: post.media, networks: post.networks },
      after: { caption: post.caption, media: next.media, networks: next.networks },
    });
    if (!resync.ok) return { status: "failed", error: resync.error };

    // 3) Subir los archivos al bucket de Contenido (mismo nombre = mismo id; se reemplaza el contenido).
    for (const file of rendered) {
      const path = `${post.workspace_id}/${post.id}/${file.fileName}`;
      const { error: uploadError } = await db.storage.from(CONTENT_MEDIA_BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: true });
      if (uploadError) throw new RenderFailed(`No se pudo guardar el archivo (${uploadError.message}).`, { retryable: true });
    }

    // 4) Escribir la pieza. Condicional sobre `updated_at`: si la persona guardó algo en el medio, se vuelve a leer y a armar.
    let wrote = false;
    for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
      const { data: updatedRows, error: updateError } = await db
        .from("content_posts")
        .update({ media: next.media as never, networks: next.networks as never })
        .eq("id", post.id)
        .eq("workspace_id", post.workspace_id)
        .eq("updated_at", current.updated_at)
        .select("id");
      if (updateError) throw new RenderFailed(`No se pudo guardar la pieza (${updateError.message}).`, { retryable: true });
      if (updatedRows && updatedRows.length > 0) {
        wrote = true;
        break;
      }
      const fresh = await readPost(db, post.id, post.workspace_id);
      if (!fresh) return { status: "skipped", reason: "post_missing" };
      current = fresh;
      next = buildState(design, doc, current, rendered, updates, outputs);
    }
    if (!wrote) throw new RenderFailed("La pieza se estaba editando: se vuelve a intentar.", { retryable: true });

    // Lo agendado en Zernio que cambió de contenido se reenvía (las redes sin cola no tienen nada que reenviar).
    const resyncWarnings = await applyContentResync(db, { workspaceId: post.workspace_id, targets: resync.targets });

    // Lo que sobra del bucket (páginas que el diseño ya no tiene) se borra después de guardar la pieza.
    if (next.deleteFromBucket.length > 0) {
      const safe = next.deleteFromBucket.filter((p) => pathBelongsTo(p, post.workspace_id));
      const { error: removeError } = await db.storage.from(CONTENT_MEDIA_BUCKET).remove(safe);
      if (removeError) console.error("[design_content_sync] no pude borrar los archivos que sobran:", removeError.message);
    }

    return { status: "synced", networks: updates.map((u) => u.platform), held, files: rendered.map((f) => f.id), warnings: [...warningsFor(updates, next.media, next.networks, pages), ...resyncWarnings] };
  } catch (error) {
    return noteFailure(db, payload, error, deps);
  }
}

function buildState(design: DesignRow, doc: DesignDoc, post: PostRow, rendered: Rendered[], updates: Update[], outputs: ReadonlySet<ContentOutput>) {
  const media = ensureMediaIds(asMedia(post.media));
  const entries: MediaEntry[] = [];
  for (const file of rendered) {
    const entry = entryFor(design, doc, post, file, media.find((m) => m.id === file.id));
    if (!entry) throw new RenderFailed("No se pudo armar uno de los archivos para la pieza.", { retryable: false });
    entries.push(entry);
  }
  const published = ["published", "partially_published", "publishing"].includes(post.status);
  return applyDesignFiles({ designId: design.id, media, networks: asNetworks(post.networks), entries, updates, postPublished: published, stalePages: outputs.has("png") });
}

/** Los avisos de lo que quedó armado: lo que Contenido va a decir al programar y lo que no cuadra con las páginas. */
function warningsFor(updates: Update[], media: MediaEntry[], networks: NetworkEntry[], pages: number): string[] {
  const out: string[] = [];
  for (const update of updates) {
    const network = networks.find((n) => n.platform === update.platform);
    const def = getFormat(update.platform, update.target.format);
    if (!network || !def) continue;
    const resolved = resolveNetworkContent({ network, baseCaption: null, baseMedia: media });
    const check = checkFormatFiles(def, resolved.media);
    if (!check.ok) out.push(`${update.target.label}: ${check.message}`);
    const fit = pageFit(update.target, pages);
    if (fit.message && check.ok) out.push(`${update.target.label}: ${fit.message}`);
  }
  return out;
}

/** Anota un fallo: reagenda lo pasajero (1, 5 y 15 minutos) o lo deja dicho. Nunca lanza. */
async function noteFailure(db: Db, payload: ContentSyncPayload, error: unknown, deps: Required<ContentSyncDeps>): Promise<ContentSyncOutcome> {
  const message = renderErrorMessage(error);
  const retryable = error instanceof RenderFailed && error.retryable && !(error instanceof RenderNotConfigured);
  if (!(error instanceof RenderFailed) && !(error instanceof RenderNotConfigured)) {
    console.error("[design_content_sync] falló:", error instanceof Error ? error.message : "error");
  }
  const attempt = (payload.retry ?? 0) + 1;
  if (retryable && attempt <= CONTENT_SYNC_RETRY_MS.length) {
    const at = new Date(deps.now().getTime() + CONTENT_SYNC_RETRY_MS[attempt - 1]);
    try {
      await deps.schedule(db, DESIGN_CONTENT_SYNC_JOB, { ...payload, retry: attempt }, at, contentSyncKey(payload.designId, payload.force === true));
      return { status: "retry", attempt, at: at.toISOString(), error: message };
    } catch (scheduleError) {
      // Ya hay uno pendiente igual (23505): alcanza con ese.
      if ((scheduleError as { code?: string })?.code === "23505") return { status: "retry", attempt, at: at.toISOString(), error: message };
      console.error("[design_content_sync] no pude reagendar:", scheduleError instanceof Error ? scheduleError.message : "error");
    }
  }
  console.error(`[design_content_sync] ${message}`);
  return { status: "failed", error: message };
}

/** El id de un archivo del diseño dentro de la biblioteca (para los tests y el verify). */
export function syncedIds(media: MediaEntry[], designId: string): string[] {
  return media.filter((m) => !m.deleted_at && m.design_id === designId).map(idOf);
}

