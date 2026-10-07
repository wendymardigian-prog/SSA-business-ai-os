/**
 * Como se publica cada red, y lo que se publico a mano (Contenido v4, C2 y C3).
 *
 * Tres operaciones, las tres de quien puede publicar (`content.publish`):
 *
 *   - **Cambiar el modo**: "La subo yo" (la fecha queda tentativa, nada en la
 *     cola) o "El sistema la publica" (crea la fila y su job, F25 sin
 *     cambios). Volver a "La subo yo" saca la red de la cola y CONSERVA la
 *     fecha.
 *   - **Marcar como publicado**: lo que se subio por fuera de la app entra
 *     como fila real de `social_posts` con `origin = 'manual'`, asi cuenta en
 *     el calendario, en Social y en el rendimiento de la pieza.
 *   - **Deshacer el marcado**: mientras la red no haya traido metricas.
 *
 * Igual que `schedule-core.ts`, no depende de la pantalla: la accion pone la
 * sesion y el permiso, y la verificacion contra la base real corre esto
 * mismo. Nunca se escribe `social_posts` con el cliente del usuario: esa
 * tabla es solo del servidor (00083).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { cleanExternalUrl } from "@/lib/content/networks-schema";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { isManualStatus } from "@/lib/content/status";
import type { ContentPostStatus, Database, SocialPlatform } from "@/lib/types/database";
import {
  runScheduleNetworks,
  runUnscheduleNetwork,
  type ScheduleActionResult,
  type ScheduleContextInput,
} from "./schedule-core";
import { refreshPostStatus } from "./settled";

type Db = SupabaseClient<Database>;

/** Lo que esta en la cola: va a salir solo. */
const QUEUED = ["scheduled", "uploading", "publishing"];

/** Un margen para relojes desparejos: "ahora" en el celular puede ser un minuto mas. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;

interface PieceForMode {
  id: string;
  status: ContentPostStatus;
  networks: NetworkEntry[];
}

async function loadPiece(ctx: ScheduleContextInput, postId: string): Promise<PieceForMode | null> {
  // Con el cliente del usuario: si la RLS no lo deja ver la pieza, no existe.
  const { data } = await ctx.supabase
    .from("content_posts")
    .select("id, status, networks")
    .eq("id", postId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    networks: (Array.isArray(data.networks) ? data.networks : []) as unknown as NetworkEntry[],
  };
}

/**
 * Cambia campos de UNA red de la pieza, leyendo lo ultimo guardado.
 *
 * Lee y escribe en el momento (no con lo que trajo `loadPiece`) para no pisar
 * un autoguardado que haya entrado en el medio.
 */
async function patchNetwork(
  service: Db,
  postId: string,
  platform: string,
  patch: (entry: NetworkEntry) => NetworkEntry,
): Promise<boolean> {
  const { data } = await service.from("content_posts").select("networks").eq("id", postId).maybeSingle();
  const networks = (Array.isArray(data?.networks) ? data.networks : []) as unknown as NetworkEntry[];
  if (!networks.some((n) => n.platform === platform)) return false;

  const next = networks.map((n) => (n.platform === platform ? patch(n) : n));
  const { error } = await service
    .from("content_posts")
    .update({ networks: next as never })
    .eq("id", postId);
  if (error) {
    console.error("[content] no pude actualizar la red:", error.message);
    return false;
  }
  return true;
}

async function liveRow(service: Db, postId: string, platform: string) {
  const { data } = await service
    .from("social_posts")
    .select(
      "id, status, origin, publisher, publisher_ref, engagement_d7, reach_d7, views_d7, interactions_d7, d7_computed_at",
    )
    .eq("content_post_id", postId)
    .eq("platform", platform as SocialPlatform)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

// ── Como se publica ──────────────────────────────────────────────────────

export async function runSetPublishMode(
  ctx: ScheduleContextInput,
  input: { postId: string; platform: string; auto: boolean },
): Promise<ScheduleActionResult<{ postStatus: string }>> {
  if (!ctx.canPublish) return { ok: false, error: "Cambiar cómo se publica es de quien puede publicar." };

  const piece = await loadPiece(ctx, input.postId);
  if (!piece) return { ok: false, error: "No encontré esa pieza." };
  if (!piece.networks.some((n) => n.platform === input.platform)) {
    return { ok: false, error: "Esa red no está en la pieza." };
  }

  const row = await liveRow(ctx.service, piece.id, input.platform);
  if (row?.status === "published") return { ok: false, error: "Esa red ya está publicada." };
  if (row?.status === "publishing") return { ok: false, error: "Se está publicando en este momento." };

  if (input.auto) {
    // Programar valida todo lo que hace falta y en el servidor (F77): cuenta
    // conectada con publicador, pieza aprobada, fecha futura, archivos del
    // formato y tope diario. Aunque la llamada se saltee el editor.
    if (!row || !QUEUED.includes(row.status ?? "")) {
      const scheduled = await runScheduleNetworks(ctx, { postId: piece.id, platform: input.platform });
      if (!scheduled.ok) return scheduled;
    }
  } else if (row && (QUEUED.includes(row.status ?? "") || row.status === "failed")) {
    // Sacarla de la cola (y de la agenda de Zernio). La fecha de la pieza no
    // se toca: queda como tentativa.
    const unscheduled = await runUnscheduleNetwork(ctx, { postId: piece.id, platform: input.platform });
    if (!unscheduled.ok) return unscheduled;
  }

  await patchNetwork(ctx.service, piece.id, input.platform, (n) => ({ ...n, auto: input.auto }));
  const postStatus = (await refreshPostStatus(ctx.service, piece.id)) ?? piece.status;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "channel",
    entityId: ctx.workspaceId,
    action: "update",
    metadata: { kind: "content_publish_mode", post_id: piece.id, platform: input.platform, auto: input.auto },
    performedBy: ctx.userId,
  });

  return { ok: true, data: { postStatus } };
}

// ── Marcar como publicado ────────────────────────────────────────────────

export async function runMarkPublished(
  ctx: ScheduleContextInput,
  input: { postId: string; platform: string; publishedAt?: string | null; url?: string | null; now?: Date },
): Promise<ScheduleActionResult<{ postStatus: string }>> {
  if (!ctx.canPublish) return { ok: false, error: "Marcar como publicado es de quien puede publicar." };

  const piece = await loadPiece(ctx, input.postId);
  if (!piece) return { ok: false, error: "No encontré esa pieza." };
  const network = piece.networks.find((n) => n.platform === input.platform);
  if (!network) return { ok: false, error: "Esa red no está en la pieza." };

  const link = cleanExternalUrl(input.url);
  if (!link.ok) return { ok: false, error: link.error };

  const now = input.now ?? new Date();
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : now;
  if (Number.isNaN(publishedAt.getTime())) return { ok: false, error: "Esa fecha no se entiende." };
  if (publishedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, error: "Esa fecha todavía no llegó: se marca cuando ya está publicada." };
  }

  let row = await liveRow(ctx.service, piece.id, input.platform);
  if (row?.status === "published") return { ok: false, error: "Esa red ya está publicada." };
  if (row?.status === "publishing") return { ok: false, error: "Se está publicando en este momento." };

  // Si estaba en la cola, primero sale de ahi (y de la agenda de Zernio):
  // si no, la subida a mano y la del sistema serian dos publicaciones.
  if (row && (QUEUED.includes(row.status ?? "") || row.status === "failed")) {
    const unscheduled = await runUnscheduleNetwork(ctx, { postId: piece.id, platform: input.platform });
    if (!unscheduled.ok) return unscheduled;
    row = await liveRow(ctx.service, piece.id, input.platform);
  }

  // La cuenta de esa red, si existe: es lo que deja que la sincronizacion
  // encuentre despues el post real y complete ESTA fila (no otra).
  const { data: account } = await ctx.service
    .from("social_accounts")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("platform", input.platform as SocialPlatform)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const fields = {
    origin: "manual" as const,
    status: "published" as const,
    published_at: publishedAt.toISOString(),
    url: link.url,
    publisher: null,
    publisher_ref: null,
    scheduled_at: null,
    social_account_id: account?.id ?? null,
    last_error: null,
    last_error_kind: null,
    attempts: 0,
  };

  // Buscar-y-escribir, nunca upsert: el indice unico es parcial (00083).
  const written = row
    ? await ctx.service.from("social_posts").update(fields).eq("id", row.id).select("id").maybeSingle()
    : await ctx.service
        .from("social_posts")
        .insert({
          ...fields,
          workspace_id: ctx.workspaceId,
          content_post_id: piece.id,
          platform: input.platform as SocialPlatform,
        })
        .select("id")
        .maybeSingle();

  if (written.error || !written.data) {
    console.error("[content] no pude marcar como publicado:", written.error?.message);
    return { ok: false, error: "No pude marcarla como publicada. Probá de nuevo." };
  }

  // A donde vuelve la pieza si se deshace: el estado elegido a mano que tenia.
  const before =
    piece.networks.find((n) => n.status_before_manual)?.status_before_manual ??
    (isManualStatus(piece.status) ? piece.status : "approved");

  await patchNetwork(ctx.service, piece.id, input.platform, (n) => ({
    ...n,
    auto: false,
    published_manually_at: now.toISOString(),
    external_url: link.url,
    status_before_manual: before,
  }));

  const postStatus = (await refreshPostStatus(ctx.service, piece.id)) ?? piece.status;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "channel",
    entityId: ctx.workspaceId,
    action: "update",
    metadata: {
      kind: "content_marked_published",
      post_id: piece.id,
      platform: input.platform,
      social_post_id: written.data.id,
    },
    performedBy: ctx.userId,
  });

  return { ok: true, data: { postStatus } };
}

// ── Deshacer el marcado ──────────────────────────────────────────────────

/** Si la red ya trajo algo propio: metricas o comentarios. Deshacer los perderia. */
async function hasNetworkData(
  service: Db,
  row: NonNullable<Awaited<ReturnType<typeof liveRow>>>,
): Promise<boolean> {
  if (
    row.engagement_d7 !== null ||
    row.reach_d7 !== null ||
    row.views_d7 !== null ||
    row.interactions_d7 !== null ||
    row.d7_computed_at !== null
  ) {
    return true;
  }
  const [metrics, comments] = await Promise.all([
    service.from("social_post_metrics_daily").select("id", { count: "exact", head: true }).eq("social_post_id", row.id),
    service.from("social_post_comments").select("id", { count: "exact", head: true }).eq("social_post_id", row.id),
  ]);
  return (metrics.count ?? 0) > 0 || (comments.count ?? 0) > 0;
}

export async function runUnmarkPublished(
  ctx: ScheduleContextInput,
  input: { postId: string; platform: string },
): Promise<ScheduleActionResult<{ postStatus: string }>> {
  if (!ctx.canPublish) return { ok: false, error: "Deshacer es de quien puede publicar." };

  const piece = await loadPiece(ctx, input.postId);
  if (!piece) return { ok: false, error: "No encontré esa pieza." };

  const row = await liveRow(ctx.service, piece.id, input.platform);
  if (!row || row.status !== "published" || row.origin !== "manual") {
    return { ok: false, error: "Solo se deshace lo que se marcó como publicado a mano." };
  }

  if (await hasNetworkData(ctx.service, row)) {
    return {
      ok: false,
      error:
        "No se puede deshacer: la red ya trajo métricas o comentarios de esta publicación, y deshacerlo los borraría.",
    };
  }

  // Borrado logico, como todo (soft delete): la fila queda 30 dias y no
  // bloquea una nueva (el indice unico mira solo las vivas).
  const { error } = await ctx.service
    .from("social_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    console.error("[content] no pude deshacer el publicado a mano:", error.message);
    return { ok: false, error: "No pude deshacerlo. Probá de nuevo." };
  }

  // Todas las redes marcadas a mano guardan el mismo estado anterior (el de
  // la primera): si otra sigue publicada, las redes deciden igual.
  const before = piece.networks.find((n) => n.platform === input.platform)?.status_before_manual ?? null;

  await patchNetwork(ctx.service, piece.id, input.platform, (n) => {
    const { published_manually_at: _p, external_url: _u, status_before_manual: _s, ...rest } = n;
    return rest;
  });

  const postStatus =
    (await refreshPostStatus(ctx.service, piece.id, {
      manual: isManualStatus(before) ? before : undefined,
    })) ?? piece.status;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "channel",
    entityId: ctx.workspaceId,
    action: "update",
    metadata: { kind: "content_unmarked_published", post_id: piece.id, platform: input.platform },
    performedBy: ctx.userId,
  });

  return { ok: true, data: { postStatus } };
}
