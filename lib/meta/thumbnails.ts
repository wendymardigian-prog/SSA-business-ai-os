/**
 * Miniaturas propias de los anuncios (Extra L, AT2, F24).
 *
 * La `thumbnail_url` que da Meta vence y vive en un servidor ajeno: pintarla directo deja un
 * cuadro roto a las semanas y manda al navegador de quien mira a un tercero. Se baja una vez,
 * se valida y se guarda en el bucket privado `ad-creatives`; la pantalla firma la URL al
 * mostrarla, con el cliente del usuario.
 *
 * - El tipo se decide por los PRIMEROS BYTES (`sniffMime`), no por el `Content-Type` ni la
 *   extension: un HTML disfrazado de imagen se rechaza.
 * - 2 MB como maximo (el limite del bucket).
 * - **Nada de lo que falla lanza.** Un 404 o una caida de red suma un intento y reagenda;
 *   si el handler lanzara, la cola reintentaria a los 10 segundos encima del reintento propio.
 * - Hasta 3 intentos por anuncio (`thumbnail_attempts`); entre uno y otro, 1 y 5 minutos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { ALLOWED_MEDIA, sniffMime } from "@/lib/content/media";
import { scheduleJob } from "@/lib/scheduler";

type Db = SupabaseClient<Database>;

export const META_AD_THUMBNAILS_JOB = "meta_ad_thumbnails";
export const AD_CREATIVES_BUCKET = "ad-creatives";

/** Cuantos anuncios se procesan por corrida. */
export const THUMBNAIL_BATCH = 25;
export const THUMBNAIL_MAX_ATTEMPTS = 3;
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Minutos de espera despues del intento 1 y del 2. Con tres intentos como tope, despues del
 * tercero no hay mas espera: el anuncio queda sin miniatura (el 15 del plano nunca llegaria a usarse).
 */
export const THUMBNAIL_RETRY_MINUTES = [1, 5] as const;

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageMime = (typeof IMAGE_MIMES)[number];

export interface JobPayload {
  workspaceId?: string;
  adAccountId?: string;
}

export type ThumbnailDownload =
  | { ok: true; bytes: Uint8Array; mime: ImageMime }
  | { ok: false; reason: "bad_url" | "http" | "too_big" | "not_image" | "network" };

/** Solo https y nunca una direccion local: la URL viene de Meta, pero el hueco se cierra igual. */
export function isSafeThumbnailUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    // Una IP suelta (v4 o v6) no es un CDN de Meta.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

/** Baja la imagen y la valida. Nunca lanza. */
export async function downloadThumbnail(url: string, fetchImpl: typeof fetch = fetch): Promise<ThumbnailDownload> {
  if (!isSafeThumbnailUrl(url)) return { ok: false, reason: "bad_url" };

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!response.ok) return { ok: false, reason: "http" };

  // Si el servidor ya avisa que pesa de mas, no se baja.
  const declared = Number(response.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > THUMBNAIL_MAX_BYTES) return { ok: false, reason: "too_big" };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, reason: "network" };
  }
  if (bytes.byteLength > THUMBNAIL_MAX_BYTES) return { ok: false, reason: "too_big" };

  const mime = sniffMime(bytes);
  if (!mime || !(IMAGE_MIMES as readonly string[]).includes(mime)) return { ok: false, reason: "not_image" };
  return { ok: true, bytes, mime: mime as ImageMime };
}

/** `{workspace_id}/{ad_id}.{ext}`: el primer segmento es lo unico que lee la policy del bucket. */
export function thumbnailPath(workspaceId: string, adId: string, mime: ImageMime): string {
  const safeId = adId.replace(/[^A-Za-z0-9_-]/g, "");
  return `${workspaceId}/${safeId}.${ALLOWED_MEDIA[mime].ext}`;
}

/** Cuando reintentar despues de `attempts` intentos fallidos, o null si ya no hay mas. */
export function retryDelayMinutes(attempts: number): number | null {
  if (attempts >= THUMBNAIL_MAX_ATTEMPTS) return null;
  return THUMBNAIL_RETRY_MINUTES[Math.max(0, attempts - 1)] ?? null;
}

export type UploadThumbnail = (path: string, bytes: Uint8Array, mime: string) => Promise<{ error: string | null }>;

const defaultUpload =
  (supabase: Db): UploadThumbnail =>
  async (path, bytes, mime) => {
    const { error } = await supabase.storage.from(AD_CREATIVES_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    return { error: error ? error.message : null };
  };

export interface ThumbnailRunResult {
  processed: number;
  saved: number;
  failed: number;
  /** Quedan anuncios por hacer (hubo mas del lote). */
  more: boolean;
}

/**
 * Procesa un lote de anuncios sin miniatura. Un fallo de un anuncio no frena a los otros y
 * ninguno lanza: el que falla suma un intento y se reagenda.
 */
export async function runThumbnailBatch(
  supabase: Db,
  params: { workspaceId: string; adAccountId: string; now?: Date },
  deps: { fetchImpl?: typeof fetch; upload?: UploadThumbnail } = {},
): Promise<ThumbnailRunResult> {
  const now = params.now ?? new Date();
  const upload = deps.upload ?? defaultUpload(supabase);

  const { data, error } = await supabase
    .from("meta_ads")
    .select("ad_id, thumbnail_source_url, thumbnail_attempts")
    .eq("workspace_id", params.workspaceId)
    .eq("ad_account_id", params.adAccountId)
    .is("thumbnail_path", null)
    .not("thumbnail_source_url", "is", null)
    .lt("thumbnail_attempts", THUMBNAIL_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(THUMBNAIL_BATCH + 1);

  if (error) {
    console.error("[meta-ads] no pude leer los anuncios sin miniatura:", error.message);
    return { processed: 0, saved: 0, failed: 0, more: false };
  }

  const all = (data ?? []) as Array<{ ad_id: string; thumbnail_source_url: string | null; thumbnail_attempts: number }>;
  const batch = all.slice(0, THUMBNAIL_BATCH);
  let saved = 0;
  let failed = 0;
  let nextRetry: number | null = null;

  for (const ad of batch) {
    if (!ad.thumbnail_source_url) continue;
    const result = await downloadThumbnail(ad.thumbnail_source_url, deps.fetchImpl);
    let uploadError: string | null = null;
    let path: string | null = null;

    if (result.ok) {
      path = thumbnailPath(params.workspaceId, ad.ad_id, result.mime);
      uploadError = (await upload(path, result.bytes, result.mime)).error;
    }

    if (result.ok && !uploadError && path) {
      await supabase
        .from("meta_ads")
        .update({ thumbnail_path: path } as never)
        .eq("workspace_id", params.workspaceId)
        .eq("ad_account_id", params.adAccountId)
        .eq("ad_id", ad.ad_id);
      saved += 1;
      continue;
    }

    failed += 1;
    const attempts = ad.thumbnail_attempts + 1;
    console.error(`[meta-ads] miniatura del anuncio ${ad.ad_id}: ${result.ok ? "no se pudo subir" : result.reason}`);
    await supabase
      .from("meta_ads")
      .update({ thumbnail_attempts: attempts } as never)
      .eq("workspace_id", params.workspaceId)
      .eq("ad_account_id", params.adAccountId)
      .eq("ad_id", ad.ad_id);
    const delay = retryDelayMinutes(attempts);
    if (delay !== null) nextRetry = Math.min(nextRetry ?? delay, delay);
  }

  const more = all.length > THUMBNAIL_BATCH;
  const delay = nextRetry ?? (more ? 1 : null);
  if (delay !== null) {
    try {
      await scheduleThumbnailJob(supabase, params.workspaceId, params.adAccountId, new Date(now.getTime() + delay * 60_000));
    } catch (err) {
      console.error("[meta-ads] no pude reagendar las miniaturas:", err instanceof Error ? err.message : err);
    }
  }

  return { processed: batch.length, saved, failed, more };
}

/** Encola el job de miniaturas de una cuenta. Uno por cuenta y por bloque de 5 minutos. */
export async function scheduleThumbnailJob(supabase: Db, workspaceId: string, adAccountId: string, runAt: Date): Promise<boolean> {
  try {
    await scheduleJob(
      supabase,
      META_AD_THUMBNAILS_JOB,
      { workspaceId, adAccountId },
      runAt,
      `meta-thumbs:${adAccountId}:${Math.floor(runAt.getTime() / 300_000)}`,
    );
    return true;
  } catch (err) {
    // 23505 = ya habia uno pendiente en ese bloque: es lo esperado.
    if ((err as { code?: string })?.code === "23505") return false;
    throw err;
  }
}
