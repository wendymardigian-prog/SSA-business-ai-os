"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getMetaToken } from "@/lib/meta/token";
import { fetchAdVideoSource } from "@/lib/meta/ad-video";
import { manualTranscriptWrite } from "@/lib/meta/ad-transcript";

/**
 * El video y la transcripcion de un anuncio, desde su detalle (noviembre 2026, 00323).
 *
 * - `getAdVideo`: pide a Meta el link del mp4 en el momento (vence en unas horas, no se guarda). Pide
 *   `dashboards.ads.view`, lo mismo que ver el anuncio. Si Meta da un id de video que no estaba guardado,
 *   se guarda (asi no hay que esperar al proximo sync).
 * - `saveAdTranscript`: la transcripcion escrita a mano. Pide `dashboards.ads.view` Y `content.create`, igual que
 *   vincular el anuncio con una pieza: es trabajo sobre el contenido del anuncio. Vacia, la borra.
 *
 * El workspace sale SIEMPRE de la sesion; el anuncio se busca en ese workspace. `meta_ads` no tiene politica de
 * escritura para la app: se escribe con el cliente de servicio DESPUES del permiso, y queda en `audit_log`
 * (entidad `meta_ad`). En un archivo `"use server"` todo lo exportado es una funcion asincronica.
 */

const NO_VIEW = "No tenés permiso para ver los anuncios.";
const NO_EDIT = "No tenés permiso para editar la transcripción. Pedile a un Admin que lo haga.";
const AD_NOT_FOUND = "No encontré ese anuncio en el catálogo. Sincronizá la cuenta y probá de nuevo.";
const NO_TOKEN = "No hay un token de Meta conectado. Conectalo en Integraciones.";
const GENERIC = "No pude guardar la transcripción. Probá de nuevo en un rato.";

const cleanId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
};

export type AdVideoActionResult =
  | { ok: true; url: string; origin: "ad_video" | "instagram"; durationSeconds: number | null }
  | { ok: false; error: string; notVideo?: boolean };

/** El link del video del anuncio, recien pedido a Meta. */
export async function getAdVideo(input: { adId: string }): Promise<AdVideoActionResult> {
  const ctx = await getPermissionAction("dashboards.ads.view");
  if (!ctx) return { ok: false, error: NO_VIEW };
  const adId = cleanId(input?.adId);
  if (!adId) return { ok: false, error: AD_NOT_FOUND };

  const service = await createServiceClient();
  const ws = ctx.workspace.id;
  const { data: ad } = await service
    .from("meta_ads")
    .select("id, ad_id, video_id, instagram_media_id")
    .eq("workspace_id", ws)
    .eq("ad_id", adId)
    .limit(1)
    .maybeSingle();
  if (!ad) return { ok: false, error: AD_NOT_FOUND };

  // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el servidor.
  const token = await getMetaToken(service, ws);
  if (!token) return { ok: false, error: NO_TOKEN };

  const result = await fetchAdVideoSource({ token, adId: ad.ad_id, videoId: ad.video_id, instagramMediaId: ad.instagram_media_id });

  // Meta dio un id de video que no teniamos: se guarda ya. Un fallo aca no frena mostrar el video.
  if (result.videoId && result.videoId !== ad.video_id) {
    const { error } = await service.from("meta_ads").update({ video_id: result.videoId } as never).eq("id", ad.id).eq("workspace_id", ws);
    if (error) console.error("[meta-ads] no pude guardar el id del video:", error.message);
  }

  if (!result.ok) return { ok: false, error: result.message, notVideo: result.code === "not_video" };
  return { ok: true, url: result.url, origin: result.origin, durationSeconds: result.durationSeconds };
}

export type AdTranscriptActionResult =
  | { ok: true; transcript: string | null; updatedAt: string | null }
  | { ok: false; error: string };

/** Guarda (o borra, si viene vacia) la transcripcion escrita a mano. */
export async function saveAdTranscript(input: { adId: string; transcript: string }): Promise<AdTranscriptActionResult> {
  const ctx = await getPermissionAction("dashboards.ads.view");
  if (!ctx) return { ok: false, error: NO_VIEW };
  if (!ctx.can("content.create")) return { ok: false, error: NO_EDIT };
  const adId = cleanId(input?.adId);
  if (!adId) return { ok: false, error: AD_NOT_FOUND };

  const parsed = manualTranscriptWrite(input?.transcript);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const service = await createServiceClient();
  const ws = ctx.workspace.id;
  const { data: ad } = await service
    .from("meta_ads")
    .select("id, ad_id, name, transcript, transcript_source")
    .eq("workspace_id", ws)
    .eq("ad_id", adId)
    .limit(1)
    .maybeSingle();
  if (!ad) return { ok: false, error: AD_NOT_FOUND };

  // Sin cambios no se escribe ni se anota nada.
  if ((ad.transcript ?? null) === parsed.value.transcript) {
    return { ok: true, transcript: parsed.value.transcript, updatedAt: null };
  }

  const now = new Date().toISOString();
  const cleared = parsed.value.transcript === null;
  const { error } = await service
    .from("meta_ads")
    .update({
      ...parsed.value,
      transcript_updated_at: cleared ? null : now,
      transcript_updated_by: cleared ? null : ctx.user.id,
    } as never)
    .eq("id", ad.id)
    .eq("workspace_id", ws);
  if (error) {
    console.error("[meta-ads] no pude guardar la transcripcion:", error.message);
    return { ok: false, error: GENERIC };
  }

  await logAudit({
    supabase: service,
    workspaceId: ws,
    entityType: "meta_ad",
    entityId: ad.id,
    action: cleared ? "transcript.cleared" : "transcript.updated",
    changes: {
      transcript: { old: ad.transcript ?? null, new: parsed.value.transcript },
      transcript_source: { old: ad.transcript_source ?? null, new: parsed.value.transcript_source },
    },
    metadata: { ad_id: ad.ad_id, ad_name: ad.name },
    performedBy: ctx.user.id,
  });

  revalidatePath(`/dashboard/dashboards/ads/ads/${ad.ad_id}`);
  return { ok: true, transcript: parsed.value.transcript, updatedAt: cleared ? null : now };
}
