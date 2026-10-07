import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { scheduleJob } from "@/lib/scheduler";
import {
  CONTENT_PROVIDER_SCHEDULE_JOB,
  CONTENT_PUBLISH_JOB,
  CONTENT_UPLOAD_JOB,
  jobTypeForPublisher,
} from "@/lib/content/jobs";
import { schedulesOnProvider } from "@/lib/publishing/provider-scheduling";
import {
  canScheduleNetwork,
  canUnschedule,
  planSchedule,
  type NetworkPlan,
} from "@/lib/content/schedule";
import { resolveNetworkContent, type NetworkEntry } from "@/lib/content/redistribution";
import { resolveNetworkOptions } from "@/lib/content/network-format";
import { socialMediaTypeFor } from "@/lib/content/media-type";
import type { MediaEntry } from "@/lib/content/media";
import { validateNetwork, type NetworkContent } from "@/lib/content/validation";
import { countPublicationsForDay } from "./daily-count";
import { cancelOnProvider } from "./provider-dispatch";
import { refreshPostStatus as refreshPieceStatus } from "./settled";
import type { ContentPostStatus, Database, SocialPlatform, SocialPostStatus } from "@/lib/types/database";

/**
 * Programar y desprogramar cada red (F25), sin depender de la pantalla.
 *
 * Programar hace TRES cosas que tienen que pasar juntas: crear la fila en
 * `social_posts`, encolar el job (o entregarle el post al proveedor, grupo
 * D), y recalcular el estado de la pieza. Si quedara a medias, la pieza
 * diria "programada" sin nada agendado, que es el peor estado posible: nadie
 * se entera hasta que no sale.
 *
 * Esto vive aparte de la Server Action a proposito. La accion pone la sesion
 * y el permiso; el trabajo esta aca, y por eso `scripts/verify-publishing.mjs`
 * puede correrlo de punta a punta contra la base real, que es la unica forma
 * de comprobar que un post programado se publica.
 */

/** Respaldo neutro, para cuando el contexto no trae la zona del workspace. */
const DEFAULT_TIME_ZONE = "UTC";

/** El contexto que la accion arma y el nucleo recibe ya resuelto. */
export interface ScheduleContextInput {
  workspaceId: string;
  userId: string;
  /** Con los permisos del usuario (RLS aplica). */
  supabase: SupabaseClient<Database>;
  /** Service role: `social_posts` y `scheduled_jobs` no las toca un usuario. */
  service: SupabaseClient<Database>;
  /** Si puede programar y despublicar (`content.publish`). */
  canPublish: boolean;
  /**
   * La zona horaria del workspace, para saber que dia es "hoy" al contar el
   * tope diario (F77). Sin ella se usa la de Costa Rica, que es la del negocio.
   */
  timeZone?: string;
  /**
   * De donde salen las claves para hablarle al proveedor al desprogramar.
   *
   * Viene de afuera y no se importa aca: asi la verificacion de punta a
   * punta puede correr este mismo codigo con un proveedor simulado, sin
   * tocar Vault ni llamar a nadie.
   */
  credentialsFor: (params: {
    publisherId: string;
    workspaceId: string;
    platform: string;
  }) => Promise<{ token: string; extra?: Record<string, string> }>;
}

export type ScheduleActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

interface PostForSchedule {
  id: string;
  status: string;
  networks: NetworkPlan[];
  /** Las opciones de cada red, para dejar anotado que se pidio (A17). */
  options: Record<string, Record<string, unknown>>;
  /**
   * Lo que se va a publicar en cada red, ya resuelto contra lo base: el mismo
   * calculo que hace el editor, asi el servidor valida exactamente lo que se
   * ve en pantalla (F77).
   */
  contents: Record<string, NetworkContent>;
  publications: Array<{ platform: string; status: SocialPostStatus | null; scheduledAt: string | null }>;
}

/** Todo lo que hace falta para decidir, en una sola lectura. */
async function loadPost(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  postId: string,
): Promise<PostForSchedule | null> {
  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, networks, caption, media")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!post) return null;

  const { data: publications } = await supabase
    .from("social_posts")
    .select("platform, status, scheduled_at")
    .eq("content_post_id", postId);

  // `networks` es jsonb: el tipo de la base no dice nada de su forma, asi que se
  // pasa por `unknown` y se lee como lo que es, una lista de `NetworkEntry`.
  const networks = (Array.isArray(post.networks) ? post.networks : []) as unknown as NetworkEntry[];
  const baseMedia = (Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[];

  return {
    id: post.id,
    status: post.status,
    networks: networks.map((n) => ({
      platform: String(n.platform ?? ""),
      plannedAt: n.planned_at ?? null,
      publisher: n.publisher ?? null,
    })),
    // Con el formato ya aplicado (F93): lo que el editor muestra, lo que se
    // valida aca y lo que se publica salen de las mismas opciones.
    options: Object.fromEntries(
      networks.map((n) => [String(n.platform ?? ""), resolveNetworkOptions(n)]),
    ),
    contents: Object.fromEntries(
      networks.map((n) => {
        const resolved = resolveNetworkContent<MediaEntry>({
          network: n,
          baseCaption: post.caption,
          baseMedia,
        });
        const content: NetworkContent = {
          platform: String(n.platform ?? ""),
          text: resolved.caption,
          media: resolved.media,
          title: n.youtube_title ?? null,
          format: n.format ?? null,
          options: resolveNetworkOptions(n),
        };
        return [content.platform, content];
      }),
    ),
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
  supabase: SupabaseClient<Database>,
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
  service: SupabaseClient<Database>,
  socialPostId: string,
) {
  // Los tres tipos: una subida larga se encola como `content_upload`, lo que
  // agenda en el proveedor como `content_provider_schedule` y el resto como
  // `content_publish`.
  for (const type of [CONTENT_PUBLISH_JOB, CONTENT_UPLOAD_JOB, CONTENT_PROVIDER_SCHEDULE_JOB]) {
    await service
      .from("scheduled_jobs")
      .delete()
      .eq("type", type)
      .eq("status", "pending")
      .contains("payload", { socialPostId });
  }
}

/**
 * Recalcula el estado de la pieza: el mismo calculo que el resto de la
 * publicacion (`settled.ts`). Antes habia una copia aca, y dos copias de la
 * misma regla terminan diciendo cosas distintas.
 */
async function refreshPostStatus(
  service: SupabaseClient<Database>,
  postId: string,
  opts: { manual?: ContentPostStatus } = {},
): Promise<string> {
  return (await refreshPieceStatus(service, postId, opts)) ?? "approved";
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
export async function runScheduleNetworks(
  ctx: ScheduleContextInput,
  input: {
    postId: string;
    platform?: string;
    /** Publicar ya, en vez de esperar la fecha. */
    now?: boolean;
  },
): Promise<ScheduleActionResult<ScheduleOutcome>> {
  const { supabase, service } = ctx;
  const workspace = { id: ctx.workspaceId };
  const user = { id: ctx.userId };
  const perms = { publish: ctx.canPublish };

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

  // El servidor repite la validacion del editor (F77). Antes corria SOLO en el
  // navegador: una llamada directa a la accion se la saltaba, y el tope diario
  // no se calculaba nunca. Una red con errores no frena a las demas.
  const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const valid: typeof plan.schedule = [];
  for (const entry of plan.schedule) {
    const content = post.contents[entry.platform];
    if (!content) {
      valid.push(entry);
      continue;
    }
    const day = await countPublicationsForDay(service, {
      workspaceId: workspace.id,
      platform: entry.platform,
      at: input.now ? new Date() : new Date(entry.at),
      timeZone,
      excludePostId: post.id,
    });
    const result = validateNetwork(content, {
      publishedToday: day.total,
      publishedTodayByKind: { video: day.video, image: day.image },
    });
    if (!result.ok) {
      plan.skipped.push({ platform: entry.platform, reason: result.errors.join(" ") });
      continue;
    }
    valid.push(entry);
  }
  plan.schedule = valid;

  if (plan.schedule.length === 0) {
    return {
      ok: false,
      error: plan.skipped[0]?.reason ?? "No hay ninguna red con fecha para programar",
    };
  }

  // Las filas y los jobs los escribe el servidor: social_posts no la toca
  // ningun usuario (00083).
  const accountByPlatform = new Map<string, string>(accounts.map((a) => [a.platform, a.id]));

  const scheduled: string[] = [];

  for (const entry of plan.schedule) {
    // Zernio agenda de su lado (D1): la fila arranca en `uploading` porque
    // primero hay que dejarle la media, y recien cuando el post existe alla
    // pasa a `scheduled`. Decir "programado" antes seria prometer algo que
    // todavia no esta agendado en ningun lado.
    const providerScheduled = schedulesOnProvider(entry.publisher);

    const fields = {
      workspace_id: workspace.id,
      content_post_id: post.id,
      social_account_id: accountByPlatform.get(entry.platform) ?? null,
      platform: entry.platform as SocialPlatform,
      publisher: entry.publisher,
      origin: "system" as const,
      status: (providerScheduled ? "uploading" : "scheduled") as SocialPostStatus,
      scheduled_at: input.now ? null : entry.at,
      // Que visibilidad se pidio, para poder comparar con como quedo
      // (YouTube puede dejarlo privado hasta que Google audite la app).
      requested_visibility:
        (post.options[entry.platform]?.visibility as string | undefined) ?? null,
      // El tipo de lo que se manda, para poder contar videos y fotos contra el
      // tope diario (F77). La metrica lo corrige con el real despues de salir.
      ...(post.contents[entry.platform]
        ? { media_type: socialMediaTypeFor(post.contents[entry.platform]) }
        : {}),
      attempts: 0,
    };

    // Buscar-y-escribir en vez de `upsert`.
    //
    // El indice unico de `social_posts` es PARCIAL (solo filas vivas, con
    // pieza), y PostgREST no puede apuntarle un `on_conflict`: el upsert
    // fallaba SIEMPRE con "no unique or exclusion constraint matching", asi
    // que **nunca se creaba ninguna fila de publicacion**. No se veia en los
    // tests porque la base en memoria no tiene indices.
    //
    // Hacerlo total tampoco sirve: el predicado `deleted_at IS NULL` esta a
    // proposito, para que una fila borrada no bloquee una nueva.
    const { data: existing } = await service
      .from("social_posts")
      .select("id")
      .eq("content_post_id", post.id)
      .eq("platform", entry.platform as SocialPlatform)
      .is("deleted_at", null)
      .maybeSingle();

    const written = existing
      ? await service
          .from("social_posts")
          .update({ ...fields, last_error: null, last_error_kind: null })
          .eq("id", existing.id)
          .select("id")
          .maybeSingle()
      : await service.from("social_posts").insert(fields).select("id").maybeSingle();

    const row = written.data;
    if (written.error || !row) {
      console.error(`[content] no pude programar ${entry.platform}:`, written.error?.message);
      plan.skipped.push({ platform: entry.platform, reason: "No pude crear la publicacion" });
      continue;
    }

    // Reprogramar: el job de la hora vieja se va antes de encolar el nuevo.
    await deletePendingPublishJobs(service, row.id);

    // scheduleJob lanza si el insert falla, no devuelve null.
    let job: { id: string } | null = null;
    try {
      job = providerScheduled
        ? // El proveedor agenda: el job de aca solo sube la media y le
          // entrega el post con su fecha. Corre YA, no a la hora de salida.
          await scheduleJob(
            service,
            CONTENT_PROVIDER_SCHEDULE_JOB,
            { socialPostId: row.id, workspaceId: workspace.id },
            new Date(),
          )
        : await scheduleJob(
            service,
            jobTypeForPublisher(entry.publisher),
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

  // Decir que salio bien sin haber programado nada es la peor respuesta
  // posible: la persona se va creyendo que la publicacion esta agendada.
  if (scheduled.length === 0) {
    return {
      ok: false,
      error: plan.skipped[0]?.reason ?? "No pude programar ninguna red",
    };
  }

  return { ok: true, data: { scheduled, skipped: plan.skipped, postStatus } };
}

/** Saca una red de la cola. La fecha tentativa se conserva. */
export async function runUnscheduleNetwork(
  ctx: ScheduleContextInput,
  input: { postId: string; platform: string },
): Promise<ScheduleActionResult<{ postStatus: string }>> {
  const { supabase, service } = ctx;
  const workspace = { id: ctx.workspaceId };
  const user = { id: ctx.userId };
  const perms = { publish: ctx.canPublish };

  const post = await loadPost(supabase, workspace.id, input.postId);
  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const publication = post.publications.find((p) => p.platform === input.platform);
  if (!publication) return { ok: false, error: "Esa red no esta programada" };

  const planned = post.networks.find((n) => n.platform === input.platform)?.plannedAt ?? null;
  const decision = canUnschedule(publication, perms, planned);
  if (!decision.ok) return { ok: false, error: decision.error };

  // Antes de cancelar de este lado hay que sacarlo de la agenda del
  // proveedor (D4): si queda alla, Zernio lo publica igual y el sistema ni
  // se entera.
  const { data: live } = await service
    .from("social_posts")
    .select("id, workspace_id, platform, publisher, publisher_ref")
    .eq("content_post_id", post.id)
    .eq("platform", input.platform as SocialPlatform)
    .maybeSingle();

  if (live?.publisher_ref && schedulesOnProvider(live.publisher)) {
    const cancelled = await cancelOnProvider(service, live, {
      credentialsFor: ctx.credentialsFor,
    });

    if (!cancelled.ok) {
      // No se cancela de este lado: decir "desprogramado" mientras Zernio lo
      // tiene agendado seria la peor mentira posible.
      return {
        ok: false,
        error: `No pude sacarlo de la agenda de Zernio: ${cancelled.detail ?? "no contesto"}. Proba de nuevo.`,
      };
    }
  }

  const { data: row } = await service
    .from("social_posts")
    .update({ status: "cancelled", publisher_ref: null })
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

  return { ok: true, data: { postStatus } };
}
