/**
 * Desconectar una cuenta con redes programadas (Contenido v4, C2).
 *
 * Antes de borrar la clave (`disconnectIntegration`), las filas programadas
 * de ESE publicador se sacan de la cola: canceladas en Zernio MIENTRAS la
 * clave todavia sirve (despues ya no se puede), y la red de la pieza vuelve
 * a `auto: false` conservando su fecha como tentativa. Sin esto, Zernio
 * publicaria igual del otro lado y el sistema ni se enteraria.
 *
 * Nunca lanza: una integracion se tiene que poder desconectar aunque algo de
 * esto falle, y lo que no se pudo desprogramar queda contado en el aviso.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { createNotificationOnce } from "@/lib/notifications/create";
import type { Database } from "@/lib/types/database";
import { schedulesOnProvider } from "./provider-scheduling";
import { cancelOnProvider } from "./provider-dispatch";
import { refreshPostStatus } from "./settled";

type Db = SupabaseClient<Database>;

interface CredentialsFor {
  (params: { publisherId: string; workspaceId: string; platform: string }): Promise<{
    token: string;
    extra?: Record<string, string>;
  }>;
}

export interface DisconnectUnscheduleResult {
  /** Cuantas redes se sacaron de la cola. */
  unscheduled: number;
  /** Las que no se pudieron sacar (Zernio no contesto): siguen en la cola. */
  failed: number;
}

/**
 * Las filas programadas de ESTE publicador: se desprograman y sus redes
 * conservan la fecha como tentativa.
 */
export async function unscheduleOnDisconnect(
  service: Db,
  params: { workspaceId: string; publisher: string; credentialsFor: CredentialsFor },
): Promise<DisconnectUnscheduleResult> {
  const { data: rows } = await service
    .from("social_posts")
    .select("id, workspace_id, content_post_id, platform, publisher, publisher_ref")
    .eq("workspace_id", params.workspaceId)
    .eq("publisher", params.publisher)
    .in("status", ["scheduled", "uploading"])
    .is("deleted_at", null);

  let unscheduled = 0;
  let failed = 0;
  const affectedPosts = new Set<string>();

  for (const row of rows ?? []) {
    try {
      if (row.publisher_ref && schedulesOnProvider(params.publisher)) {
        const cancelled = await cancelOnProvider(service, row, { credentialsFor: params.credentialsFor });
        if (!cancelled.ok) {
          failed += 1;
          continue;
        }
      }

      await service.from("social_posts").update({ status: "cancelled", publisher_ref: null }).eq("id", row.id);

      await service
        .from("scheduled_jobs")
        .delete()
        .eq("status", "pending")
        .contains("payload", { socialPostId: row.id });

      if (row.content_post_id) {
        const { data: post } = await service
          .from("content_posts")
          .select("networks")
          .eq("id", row.content_post_id)
          .maybeSingle();
        const networks = (Array.isArray(post?.networks) ? post.networks : []) as Array<Record<string, unknown>>;
        const next = networks.map((n) =>
          n.platform === row.platform ? { ...n, auto: false } : n,
        );
        await service.from("content_posts").update({ networks: next as never }).eq("id", row.content_post_id);
        affectedPosts.add(row.content_post_id);
      }

      unscheduled += 1;
    } catch (err) {
      console.error(`[publishing] no pude desprogramar ${row.platform} al desconectar:`, err);
      failed += 1;
    }
  }

  for (const postId of affectedPosts) {
    await refreshPostStatus(service, postId);
  }

  if (unscheduled > 0) {
    await createNotificationOnce({
      supabase: service,
      workspaceId: params.workspaceId,
      type: "content_networks_unscheduled",
      title: "Desconectaste una cuenta con publicaciones programadas",
      body: `${unscheduled} ${unscheduled === 1 ? "publicación quedó" : "publicaciones quedaron"} como fecha tentativa: vas a tener que subirlas a mano.`,
      entityType: "integration",
      entityId: null,
      withinMinutes: 1,
    });
  }

  if (unscheduled > 0 || failed > 0) {
    await logAudit({
      supabase: service,
      workspaceId: params.workspaceId,
      entityType: "social_account",
      entityId: params.workspaceId,
      action: "update",
      metadata: { kind: "content_networks_unscheduled_on_disconnect", publisher: params.publisher, unscheduled, failed },
      performedBy: null,
    });
  }

  return { unscheduled, failed };
}
