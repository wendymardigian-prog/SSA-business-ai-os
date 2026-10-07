/**
 * Lo que pasa cuando una red termina, en un solo lugar (A6, A13).
 *
 * Una publicacion puede cerrarse por tres caminos distintos: el publicador
 * contesta "publicado" en el momento, la revision lo descubre despues, o
 * llega el aviso del proveedor por webhook. Cada uno hacia una parte del
 * trabajo:
 *
 * - Solo el primero completaba el `postIds` de la automatizacion (F39). Como
 *   Zernio casi siempre contesta "en proceso", **la automatizacion "solo este
 *   post" nunca recibia el id**: quedaba escuchando un post que no existia.
 * - Ninguno recalculaba el estado de la pieza cuando una red fallaba o
 *   quedaba en proceso, asi que el tablero mostraba "programado" para algo
 *   que ya habia fallado.
 * - Un `failed` DEVUELTO (no lanzado) no avisaba a nadie.
 *
 * Ahora los tres llaman aca y esto lee de la base como quedo la fila. Que
 * sea una sola funcion es lo que hace que agregar un cuarto camino (la
 * conciliacion con Zernio) no vuelva a dejar un agujero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentPostStatus, Database } from "@/lib/types/database";
import { derivePieceStatus, isManualStatus } from "@/lib/content/status";
import { notifyPublishFailure } from "@/lib/notifications/content";
import { completePostIds } from "./post-ids";
import type { NetworkCta } from "@/lib/content/keywords";

type Db = SupabaseClient<Database>;

interface SettledRow {
  id: string;
  workspace_id: string;
  content_post_id: string | null;
  platform: string;
  status: string | null;
  external_post_id: string | null;
  social_account_id: string | null;
  last_error: string | null;
}

/**
 * Recalcula el estado de la pieza a partir de sus redes.
 *
 * Se llama SIEMPRE, incluso cuando la red quedo en proceso: el estado de la
 * pieza es el resumen de lo que esta pasando, y un resumen viejo es una
 * pantalla que miente.
 *
 * Desde Contenido v4 cuentan TODAS las redes de la pieza, tengan fila o no
 * (`derivePieceStatus`): una red tentativa es una red que todavia no salio.
 * Si las redes no definen nada, vale el estado elegido a mano: el que tiene
 * la pieza si es uno de esos, `manual` si quien llama sabe cual (deshacer un
 * publicado a mano), o Aprobado, que es a donde volvia una pieza programada
 * a la que se le saco todo de la cola.
 */
export async function refreshPostStatus(
  supabase: Db,
  contentPostId: string | null,
  opts: { manual?: ContentPostStatus } = {},
): Promise<ContentPostStatus | null> {
  if (!contentPostId) return null;

  const [{ data: post }, { data: rows }] = await Promise.all([
    supabase.from("content_posts").select("status, networks").eq("id", contentPostId).maybeSingle(),
    supabase
      .from("social_posts")
      .select("platform, status")
      .eq("content_post_id", contentPostId)
      .is("deleted_at", null),
  ]);

  const networks = (Array.isArray(post?.networks) ? post.networks : []) as Array<{ platform?: string }>;
  const manual: ContentPostStatus =
    opts.manual ?? (isManualStatus(post?.status) ? (post?.status as ContentPostStatus) : "approved");

  const status = derivePieceStatus({
    platforms: networks.map((n) => String(n.platform ?? "")).filter(Boolean),
    publications: (rows ?? []).map((r) => ({ platform: r.platform as string, status: r.status })),
    manual,
  });
  await supabase.from("content_posts").update({ status }).eq("id", contentPostId);
  return status;
}

/** El CTA que la pieza configuro para esa red, y el canal de la cuenta. */
async function ctaFor(
  supabase: Db,
  row: SettledRow,
): Promise<{ cta: NetworkCta | null; channelId: string | null }> {
  const [post, account] = await Promise.all([
    row.content_post_id
      ? supabase.from("content_posts").select("networks").eq("id", row.content_post_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.social_account_id
      ? supabase.from("social_accounts").select("channel_id").eq("id", row.social_account_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const networks = (Array.isArray(post.data?.networks) ? post.data.networks : []) as Array<{
    platform?: string;
    cta?: NetworkCta | null;
  }>;

  return {
    cta: networks.find((n) => n.platform === row.platform)?.cta ?? null,
    channelId: (account.data as { channel_id?: string | null } | null)?.channel_id ?? null,
  };
}

/**
 * Cierra una red: completa la automatizacion, recalcula la pieza y avisa.
 *
 * Idempotente a proposito: los tres caminos pueden pisarse (el webhook llega
 * mientras corre la revision) y volver a completar un `postIds` que ya
 * estaba no cambia nada, porque `planPostId` devuelve null si el id ya esta.
 *
 * Nunca lanza: que no salga un aviso no puede deshacer una publicacion que
 * ya salio.
 */
export async function onPublicationSettled(supabase: Db, socialPostId: string): Promise<void> {
  const { data } = await supabase
    .from("social_posts")
    .select(
      "id, workspace_id, content_post_id, platform, status, external_post_id, social_account_id, last_error",
    )
    .eq("id", socialPostId)
    .maybeSingle();

  const row = data as SettledRow | null;
  if (!row) return;

  try {
    if (row.status === "published") {
      const { cta, channelId } = await ctaFor(supabase, row);
      await completePostIds(supabase, {
        workspaceId: row.workspace_id,
        platform: row.platform,
        channelId,
        cta,
        externalPostId: row.external_post_id,
      });
    }

    if (row.status === "failed") {
      await notifyPublishFailure(supabase, {
        workspaceId: row.workspace_id,
        contentPostId: row.content_post_id,
        platform: row.platform,
        reason: row.last_error ?? `No pude publicar en ${row.platform}.`,
      });
    }
  } catch (err) {
    console.error("[publishing] el cierre de la publicacion fallo:", err);
  }

  // Ultimo y siempre: aunque lo de arriba falle, el estado de la pieza tiene
  // que quedar al dia.
  await refreshPostStatus(supabase, row.content_post_id);
}
