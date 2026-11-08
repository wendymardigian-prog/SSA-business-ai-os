/**
 * Sincronizar los archivos de un diseño con su pieza de Contenido (DS8, F64): las reglas, puras y con sus tests.
 *
 * Qué se hace según el estado de CADA red de la pieza (los cinco de `networkStateOf`, no el de la pieza entera):
 *   - sin fecha o fecha tentativa («la subo yo») → se actualiza sola al guardar una versión del diseño;
 *   - programada, o con la publicación fallida → no se toca: la pieza avisa «El diseño cambió» y la persona decide;
 *   - publicada (o publicada a mano) → nunca se toca.
 * Una publicación que falló estaba programada y alguien la va a reintentar: cambiarle los archivos sola puede
 * reintentar con otra pieza sin que nadie lo note (queda anotado en `docs/PENDIENTE-designer.md`).
 *
 * Los archivos tienen id ESTABLE: `design-<diseño>-<n>` (un PNG por página, n desde 1) o `design-<diseño>-pdf`. Es el
 * nombre del archivo en el bucket (`<ws>/<pieza>/<id>.<ext>`), así que `mediaIdFor` da el mismo id siempre y las redes
 * siguen apuntando a los mismos aunque el contenido cambie.
 *
 * Esto no sabe nada de la base ni del render (eso es del job y de `content-link.ts`), salvo `enqueueContentSync*`.
 *
 * Solo servidor (`enqueue*` usa el cliente de servicio); el resto se puede importar desde el navegador.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaEntry } from "@/lib/content/media";
import type { NetworkStateId } from "@/lib/content/network-state";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";
import { contentTarget, pageFit, targetsForPlatform, type ContentFilePlan, type ContentOutput, type ContentTarget } from "./content-map";
import type { FormatKey } from "./formats";

export const DESIGN_CONTENT_SYNC_JOB = "design_content_sync";

/** La espera para juntar los cambios de un diseño antes de sincronizar (F64). */
export const CONTENT_SYNC_WAIT_MS = 30_000;

/** Esperas entre intentos cuando el servicio de render falla de forma pasajera: 1, 5 y 15 minutos. */
export const CONTENT_SYNC_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

// ─── Qué se hace según el estado de la red ──────────────────────────────────

export type SyncAction = "update" | "notify" | "skip";

/**
 * Qué hacer con una red según su estado. `update` = reemplazar sus archivos; `notify` = dejar todo como está y avisar
 * («El diseño cambió»); `skip` = no tocar nunca. Los cinco estados de `networkStateOf`.
 */
export function syncDecision(state: NetworkStateId): SyncAction {
  switch (state) {
    case "none":
    case "tent":
      return "update";
    case "sched":
    case "fail":
      return "notify";
    case "pub":
      return "skip";
  }
}

/** Con «Actualizar los archivos» la persona confirmó: lo programado (o fallido) se actualiza; lo publicado, nunca. */
export function syncDecisionWithForce(state: NetworkStateId, force: boolean): SyncAction {
  const decision = syncDecision(state);
  return force && decision === "notify" ? "update" : decision;
}

// ─── Ids y nombres estables ─────────────────────────────────────────────────

/** El id del archivo de una página (n desde 1) o del PDF. No cambia entre sincronizaciones. */
export function designFileId(designId: string, output: ContentOutput, page = 1): string {
  return output === "pdf" ? `design-${designId}-pdf` : `design-${designId}-${page}`;
}

/** Los ids de los archivos que arma un plan, en orden (el orden en que se publican). */
export function designFileIds(designId: string, plan: ContentFilePlan): string[] {
  if (plan.output === "pdf") return [designFileId(designId, "pdf")];
  return Array.from({ length: plan.count }, (_, i) => designFileId(designId, "png", i + 1));
}

/** El nombre del archivo en el bucket: el id más la extensión. `mediaIdFor` lo vuelve a dar. */
export function designFileName(designId: string, output: ContentOutput, page = 1): string {
  return `${designFileId(designId, output, page)}.${output === "pdf" ? "pdf" : "png"}`;
}

const DESIGN_FILE_RE = /^design-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+|pdf)$/;

/** El diseño de un id de archivo armado por la sincronización; null si es de otro lado (un archivo subido a mano). */
export function designIdOfFile(fileId: string): string | null {
  return DESIGN_FILE_RE.exec(fileId)?.[1] ?? null;
}

export function isDesignFileId(fileId: string, designId?: string): boolean {
  const owner = designIdOfFile(fileId);
  return owner !== null && (designId === undefined || owner === designId);
}

// ─── La biblioteca agrupada por diseño (F65) ────────────────────────────────

export interface DesignGroup {
  designId: string;
  /** Sus archivos vivos, en orden: las páginas por número y el PDF al final. */
  entries: MediaEntry[];
  /** La `rev` del diseño con la que se renderizó lo más nuevo; null si ninguno la trae. */
  version: number | null;
}

const orderOf = (entry: MediaEntry) => (typeof entry.design_page === "number" ? entry.design_page : Number.MAX_SAFE_INTEGER);

/**
 * Agrupa los archivos de la biblioteca por el diseño del que salen (F65). Los archivos sin `design_id` no entran en
 * ningún grupo. Los borrados tampoco. Los grupos salen en el orden en que aparecen sus primeros archivos.
 */
export function designGroups(media: MediaEntry[]): DesignGroup[] {
  const groups = new Map<string, MediaEntry[]>();
  for (const entry of media) {
    if (entry.deleted_at || typeof entry.design_id !== "string" || entry.design_id === "") continue;
    const list = groups.get(entry.design_id) ?? [];
    list.push(entry);
    groups.set(entry.design_id, list);
  }
  return [...groups.entries()].map(([designId, entries]) => {
    const versions = entries.map((e) => e.design_version).filter((v): v is number => typeof v === "number");
    return {
      designId,
      entries: entries.map((entry, index) => ({ entry, index })).sort((a, b) => orderOf(a.entry) - orderOf(b.entry) || a.index - b.index).map((x) => x.entry),
      version: versions.length > 0 ? Math.max(...versions) : null,
    };
  });
}

// ─── El aviso «El diseño cambió» (F64, F65) ─────────────────────────────────

/**
 * Cómo está el vínculo de un diseño con su pieza, según lo que ya se sincronizó:
 *   - `synced`: los archivos son los de la versión actual del diseño (o la red ya salió y no se toca).
 *   - `pending`: el diseño cambió y la red se actualiza sola (o todavía no se armaron los archivos).
 *   - `changed`: el diseño cambió y la red está programada (o falló): hay que decidir. Aviso con dos botones.
 */
export type DesignSyncStatus = "synced" | "pending" | "changed";

export function designSyncStatus(params: { designRev: number; syncedVersion: number | null; networkState: NetworkStateId | null }): DesignSyncStatus {
  const { designRev, syncedVersion } = params;
  const upToDate = syncedVersion !== null && designRev <= syncedVersion;
  // Una red que ya salió no se toca nunca: no hay nada pendiente ni nada que decidir.
  if (params.networkState === "pub") return "synced";
  if (upToDate) return "synced";
  // La red ya no está en la pieza: no hay a dónde sincronizar.
  if (params.networkState === null) return "synced";
  return syncDecision(params.networkState) === "update" ? "pending" : "changed";
}

/** Los textos del aviso, para que el drawer y los tests digan lo mismo. */
export const DESIGN_CHANGED_TEXT = {
  title: "El diseño cambió",
  body: "La pieza está programada: los archivos no se cambiaron solos.",
  update: "Actualizar los archivos",
  keep: "Dejar como está",
} as const;

// ─── Elegir la publicación al vincular a una pieza existente ────────────────

/**
 * La publicación de Contenido a la que corresponde un diseño en una red (modo «Vincular a una pieza existente»).
 * Si la red de la pieza ya tiene un formato que sirve, se respeta; si no, se elige uno que cuadre con las páginas del
 * diseño (un carrusel con varias páginas, una imagen con una). Null si el diseño no sirve para esa red.
 */
export function pickTargetForLink(params: { platform: string; designFormat: FormatKey; pageCount: number; existingFormat?: string | null }): ContentTarget | null {
  const candidates = targetsForPlatform(params.platform).filter((t) => t.designFormats.includes(params.designFormat));
  if (candidates.length === 0) return null;
  const existing = params.existingFormat ? contentTarget(params.platform, params.existingFormat) : null;
  if (existing && candidates.some((t) => t.format === existing.format)) return existing;
  const ranked = candidates
    .map((target, index) => ({ target, index, ok: pageFit(target, params.pageCount).level === "ok", shape: target.multiPage === params.pageCount > 1 }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.shape) - Number(a.shape) || a.index - b.index);
  return ranked[0].target;
}

// ─── Encolar la sincronización ──────────────────────────────────────────────

type Db = SupabaseClient<Database>;

export interface ContentSyncPayload {
  designId: string;
  /** «Actualizar los archivos»: lo programado o fallido se actualiza igual (lo publicado, nunca). */
  force?: boolean;
  /** Primera sincronización de «Crear una pieza nueva»: las demás redes que reciben los mismos archivos. */
  networks?: string[];
  /** Reintentos del servicio de render (1, 5 y 15 minutos). */
  retry?: number;
}

/** La clave de dedupe: dos guardados seguidos juntan sus cambios en UNA sincronización (el job lee el diseño al correr). */
export function contentSyncKey(designId: string, force = false): string {
  return `${DESIGN_CONTENT_SYNC_JOB}:${designId}${force ? ":force" : ""}`;
}

export interface EnqueueDeps {
  schedule?: typeof scheduleJob;
  now?: () => Date;
}

/** Encola la sincronización de un diseño. Con una igual pendiente (23505) alcanza con esa. Nunca lanza por eso. */
export async function enqueueContentSync(db: Db, payload: ContentSyncPayload, opts: { waitMs?: number } & EnqueueDeps = {}): Promise<{ queued: boolean }> {
  const now = (opts.now ?? (() => new Date()))();
  const runAt = new Date(now.getTime() + (opts.waitMs ?? 0));
  try {
    await (opts.schedule ?? scheduleJob)(db, DESIGN_CONTENT_SYNC_JOB, { ...payload }, runAt, contentSyncKey(payload.designId, payload.force === true));
    return { queued: true };
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return { queued: false };
    throw error;
  }
}

/**
 * Guardar una versión del diseño encola la sincronización (con 30 s de espera para juntar cambios) SOLO si el diseño
 * está vinculado a una pieza y no está archivado. Nunca lanza: guardar el diseño no puede fallar por esto. Lo llaman
 * las acciones que guardan (`saveDesignDoc`, la IA al terminar, restaurar una versión).
 */
export async function enqueueContentSyncIfLinked(db: Db, designId: string, deps: EnqueueDeps = {}): Promise<{ queued: boolean }> {
  try {
    const { data, error } = await db.from("designs").select("content_post_id, archived_at, template_id").eq("id", designId).maybeSingle();
    if (error || !data) return { queued: false };
    const row = data as { content_post_id: string | null; archived_at: string | null; template_id: string | null };
    if (!row.content_post_id || row.archived_at || row.template_id) return { queued: false };
    return await enqueueContentSync(db, { designId }, { waitMs: CONTENT_SYNC_WAIT_MS, ...deps });
  } catch (error) {
    console.error("[design_content_sync] no pude encolar la sincronización:", error instanceof Error ? error.message : "error");
    return { queued: false };
  }
}
