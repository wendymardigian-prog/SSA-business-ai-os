"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { scheduleJob } from "@/lib/scheduler";
import { CONTENT_PUBLISH_JOB } from "@/lib/content/jobs";
import {
  canScheduleNetwork,
  canUnschedule,
  planSchedule,
  type NetworkPlan,
} from "@/lib/content/schedule";
import { aggregatePostStatus } from "@/lib/content/status";
import type { SocialPlatform, SocialPostStatus } from "@/lib/types/database";

/**
 * Programar y desprogramar cada red (F25).
 *
 * Programar hace TRES cosas que tienen que pasar juntas: crear la fila en
 * `social_posts`, encolar el job, y recalcular el estado de la pieza. Si
 * quedara a medias, la pieza diria "programada" sin nada agendado, que es el
 * peor estado posible: nadie se entera hasta que no sale.
 *
 * Por eso el orden es fila → job → estado, y si el job no se encola la fila
 * se marca fallida en vez de quedar mintiendo.
 */

const CONTENT_PATH = "/dashboard/content";

export type ScheduleActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

interface PostForSchedule {
  id: string;
  status: string;
  networks: NetworkPlan[];
  publications: Array<{ platform: string; status: SocialPostStatus | null; scheduledAt: string | null }>;
}

/** Todo lo que hace falta para decidir, en una sola lectura. */
async function loadPost(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
  postId: string,
): Promise<PostForSchedule | null> {
  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, networks")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!post) return null;

  const { data: publications } = await supabase
    .from("social_posts")
    .select("platform, status, scheduled_at")
    .eq("content_post_id", postId);

  const networks = (Array.isArray(post.networks) ? post.networks : []) as Array<{
    platform?: string;
    planned_at?: string | null;
    publisher?: string | null;
  }>;

  return {
    id: post.id,
    status: post.status,
    networks: networks.map((n) => ({
      platform: String(n.platform ?? ""),
      plannedAt: n.planned_at ?? null,
      publisher: n.publisher ?? null,
    })),
    publications: (publications ?? []).map((p) => ({
      platform: p.platform,
      status: p.status,
      scheduledAt: p.scheduled_at,
    })),
  };
}

interface ActiveAccount {
  id: string;
  platform: string;
  defaultPublisher: string | null;
}

/**
 * Las cuentas ACTIVAS del workspace, una por red.
 *
 * Trae el publicador por defecto porque `networks[].publisher` casi nunca
 * viene escrito: la pantalla no lo pide. Sin este respaldo la fila se crea
 * sin publicador y el despachador no sabe con que publicarla (A1).
 *
 * Y filtra `is_active` porque enganchar la publicacion a una cuenta
 * desconectada es programar algo que no va a salir (A16).
 */
async function activeAccounts(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
): Promise<ActiveAccount[]> {
  const { data } = await supabase
    .from("social_accounts")
    .select("id, platform, default_publisher")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  return (data ?? []).map((a) => ({
    id: a.id as string,
    platform: a.platform as string,
    defaultPublisher: (a.default_publisher as string | null) ?? null,
  }));
}

/**
 * Borra los jobs de publicacion que todavia no salieron para esa fila.
 *
 * Reprogramar hacia un upsert de la fila y encolaba un job nuevo sin tocar el
 * viejo: a la hora vieja salia igual (A4). Un solo lugar para las dos veces
 * que hace falta, reprogramar y desprogramar.
 */
async function deletePendingPublishJobs(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  socialPostId: string,
) {
  await service
    .from("scheduled_jobs")
    .delete()
    .eq("type", CONTENT_PUBLISH_JOB)
    .eq("status", "pending")
    .contains("payload", { socialPostId });
}

/** Recalcula el estado de la pieza a partir de sus publicaciones. */
async function refreshPostStatus(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  postId: string,
) {
  const { data: publications } = await service
    .from("social_posts")
    .select("status")
    .eq("content_post_id", postId)
    .is("deleted_at", null);

  const status = aggregatePostStatus(publications ?? []);
  await service.from("content_posts").update({ status }).eq("id", postId);
  return status;
}

export interface ScheduleOutcome {
  scheduled: string[];
  skipped: Array<{ platform: string; reason: string }>;
  postStatus: string;
}

/**
 * Programa una red o todas las que tengan fecha.
 *
 * `platform` acotado a una red es "Programar solo esta"; sin el, son todas.
 */
export async function scheduleNetworks(input: {
  postId: string;
  platform?: string;
  /** Publicar ya, en vez de esperar la fecha. */
  now?: boolean;
}): Promise<ScheduleActionResult<ScheduleOutcome>> {
  // Programar es `content.publish`, no "ser admin" (A20): un rol
  // personalizado con ese permiso tiene que poder, y un admin al que se lo
  // sacaron, no.
  const { workspace, user, supabase, can } = await getPermissionContext();
  const perms = { publish: can("content.publish") };

  const post = await loadPost(supabase, workspace.id, input.postId);
  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const accounts = await activeAccounts(supabase, workspace.id);
  const context = {
    postStatus: post.status,
    perms,
    connected: accounts.map((a) => a.platform),
    defaultPublishers: Object.fromEntries(accounts.map((a) => [a.platform, a.defaultPublisher])),
    existing: post.publications,
    mode: input.now ? ("now" as const) : ("scheduled" as const),
  };

  const targets = input.platform
    ? post.networks.filter((n) => n.platform === input.platform)
    : post.networks;

  if (targets.length === 0) {
    return { ok: false, error: "Esa red no esta en la pieza" };
  }

  // "Publicar ahora" es la misma operacion con la hora de este momento: un
  // solo camino de publicacion para todo (§10). La hora la pone
  // `canScheduleNetwork` en modo `now`, que ademas saltea la anticipacion:
  // ponerla antes y validarla despues la rechazaba siempre por "falta muy
  // poco" (A3).
  const plan = input.platform
    ? (() => {
        const decision = canScheduleNetwork(targets[0], context);
        return decision.ok
          ? {
              schedule: [
                { platform: targets[0].platform, at: decision.at, publisher: decision.publisher },
              ],
              skipped: [],
            }
          : { schedule: [], skipped: [{ platform: targets[0].platform, reason: decision.error }] };
      })()
    : planSchedule(targets, context);

  if (plan.schedule.length === 0) {
    return {
      ok: false,
      error: plan.skipped[0]?.reason ?? "No hay ninguna red con fecha para programar",
    };
  }

  // Las filas y los jobs los escribe el servidor: social_posts no la toca
  // ningun usuario (00083).
  const service = await createServiceClient();

  const accountByPlatform = new Map<string, string>(accounts.map((a) => [a.platform, a.id]));

  const scheduled: string[] = [];

  for (const entry of plan.schedule) {
    const { data: row, error } = await service
      .from("social_posts")
      .upsert(
        {
          workspace_id: workspace.id,
          content_post_id: post.id,
          social_account_id: accountByPlatform.get(entry.platform) ?? null,
          platform: entry.platform as SocialPlatform,
          publisher: entry.publisher,
          origin: "system",
          status: "scheduled",
          scheduled_at: entry.at,
          attempts: 0,
        },
        { onConflict: "content_post_id,platform" },
      )
      .select("id")
      .maybeSingle();

    if (error || !row) {
      console.error(`[content] no pude programar ${entry.platform}:`, error?.message);
      plan.skipped.push({ platform: entry.platform, reason: "No pude crear la publicacion" });
      continue;
    }

    // Reprogramar: el job de la hora vieja se va antes de encolar el nuevo.
    await deletePendingPublishJobs(service, row.id);

    // scheduleJob lanza si el insert falla, no devuelve null.
    let job: { id: string } | null = null;
    try {
      job = await scheduleJob(
        service,
        CONTENT_PUBLISH_JOB,
        { socialPostId: row.id, workspaceId: workspace.id },
        new Date(entry.at),
      );
    } catch (err) {
      console.error(`[content] no pude agendar ${entry.platform}:`, err);
    }

    if (!job) {
      // Sin job no hay publicacion: dejar la fila diciendo "programado"
      // seria mentir hasta que alguien mire.
      await service
        .from("social_posts")
        .update({
          status: "failed",
          last_error: "No pude agendar la publicacion. Proba de nuevo.",
          last_error_kind: "temporary",
        })
        .eq("id", row.id);
      plan.skipped.push({ platform: entry.platform, reason: "No pude agendar la publicacion" });
      continue;
    }

    scheduled.push(entry.platform);
  }

  const postStatus = await refreshPostStatus(service, post.id);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: {
      kind: input.now ? "content_publish_now" : "content_scheduled",
      post_id: post.id,
      platforms: scheduled,
    },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { scheduled, skipped: plan.skipped, postStatus } };
}

/** Saca una red de la cola. La fecha tentativa se conserva. */
export async function unscheduleNetwork(input: {
  postId: string;
  platform: string;
}): Promise<ScheduleActionResult<{ postStatus: string }>> {
  const { workspace, user, supabase, can } = await getPermissionContext();
  const perms = { publish: can("content.publish") };

  const post = await loadPost(supabase, workspace.id, input.postId);
  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const publication = post.publications.find((p) => p.platform === input.platform);
  if (!publication) return { ok: false, error: "Esa red no esta programada" };

  const planned = post.networks.find((n) => n.platform === input.platform)?.plannedAt ?? null;
  const decision = canUnschedule(publication, perms, planned);
  if (!decision.ok) return { ok: false, error: decision.error };

  const service = await createServiceClient();

  const { data: row } = await service
    .from("social_posts")
    .update({ status: "cancelled" })
    .eq("content_post_id", post.id)
    .eq("platform", input.platform as SocialPlatform)
    .select("id")
    .maybeSingle();

  // El job se cancela borrandolo: si quedara, publicaria algo que se
  // desprogramo.
  if (row) await deletePendingPublishJobs(service, row.id);

  const postStatus = await refreshPostStatus(service, post.id);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_unscheduled", post_id: post.id, platform: input.platform },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { postStatus } };
}
