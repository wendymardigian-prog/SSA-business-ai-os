/**
 * El despachador de publicaciones (F35).
 *
 * Es el unico lugar donde una fila de `social_posts` pasa de "programada" a
 * "publicada". Tres cosas lo definen:
 *
 * 1. **No publicar dos veces.** La fila se toma con
 *    `UPDATE ... WHERE status = 'scheduled' RETURNING`: si dos corridas del
 *    cron llegan juntas, una sola se lleva la fila y la otra no encuentra
 *    nada. Publicar dos veces no se puede deshacer.
 * 2. **Distinguir "fallo" de "todavia no".** Un 429 se reintenta al minuto,
 *    a los 5 y a los 15. Un 401 no: no va a mejorar solo, y gastar tres
 *    intentos contra una cuenta desconectada solo retrasa el aviso.
 * 3. **Contar lo que quedo en el aire.** Zernio y Postproxy contestan
 *    "recibido" y avisan despues por webhook. Esa fila queda "publicando" con
 *    una referencia, y un job de revision pregunta por si el webhook no llega.
 *
 * Lo que decide es puro y esta arriba; lo que escribe esta abajo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPostStatus } from "@/lib/types/database";
import { PublishError, classifyPublishError, humanizePublishError } from "@/lib/jobs/errors";
import { CONTENT_PUBLISH_CHECK_JOB, CONTENT_PUBLISH_JOB } from "@/lib/content/jobs";
import { aggregatePostStatus } from "@/lib/content/status";
import { notifyPublishFailure } from "@/lib/notifications/content";
import { liveMedia, type MediaEntry } from "@/lib/content/media";
import { resolveNetworkContent, type NetworkEntry } from "@/lib/content/redistribution";
import { completePostIds } from "./post-ids";
import { scheduleJob } from "@/lib/scheduler";
import { getPublisher, UnknownPublisherError } from "./registry";
import type { PublishInput, PublishResult, PublishCredentials } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Cuanto se espera entre intentos: 1 minuto, 5 y 15.
 *
 * Mas largo que el backoff general de la cola (10 s, 20 s) a proposito: las
 * redes cortan por volumen, y volver a los diez segundos es pedirle al mismo
 * limite que nos vuelva a cortar.
 */
export const PUBLISH_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export const MAX_PUBLISH_ATTEMPTS = PUBLISH_RETRY_DELAYS_MS.length;

/** Cada cuanto se vuelve a preguntar por una publicacion en proceso. */
export const RECHECK_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000] as const;

export type AttemptDecision =
  | { action: "retry"; delayMs: number }
  | { action: "give_up"; reason: "permanent" | "exhausted" };

/**
 * Que hacer despues de un intento fallido.
 *
 * `attempts` es cuantos van HECHOS, contando este.
 */
export function nextPublishAttempt(attempts: number, kind: "temporary" | "permanent"): AttemptDecision {
  if (kind === "permanent") return { action: "give_up", reason: "permanent" };
  if (attempts >= MAX_PUBLISH_ATTEMPTS) return { action: "give_up", reason: "exhausted" };
  return { action: "retry", delayMs: PUBLISH_RETRY_DELAYS_MS[attempts - 1] ?? PUBLISH_RETRY_DELAYS_MS[0] };
}

/** Cuanto esperar antes de volver a preguntar por una que quedo en proceso. */
export function nextRecheckDelay(checks: number): number | null {
  return RECHECK_DELAYS_MS[checks] ?? null;
}

export interface PublicationRow {
  status: SocialPostStatus | null;
  attempts: number;
  published_at: string | null;
  external_post_id: string | null;
  url: string | null;
  publisher_ref: string | null;
  last_error: string | null;
  last_error_kind: "temporary" | "permanent" | null;
  actual_visibility: string | null;
  warning: string | null;
}

/**
 * Como queda la fila despues de un resultado del proveedor.
 *
 * Se arma aparte del insert para poder probar la tabla de verdad: que
 * "processing" NO borre el error anterior antes de tiempo, que "published"
 * limpie el error, y que la fecha de publicacion se ponga una sola vez.
 */
export function rowFromResult(
  result: PublishResult,
  now: Date,
): Partial<PublicationRow> {
  if (result.status === "published") {
    return {
      status: "published",
      published_at: now.toISOString(),
      external_post_id: result.externalId ?? null,
      url: result.externalUrl ?? null,
      publisher_ref: result.ref ?? null,
      last_error: null,
      last_error_kind: null,
      actual_visibility: result.actualVisibility ?? null,
      warning: result.warning ?? null,
    };
  }

  if (result.status === "processing") {
    return {
      status: "publishing",
      publisher_ref: result.ref ?? null,
      last_error: null,
      last_error_kind: null,
    };
  }

  return {
    status: "failed",
    last_error: result.error ?? "La red rechazo la publicacion",
    last_error_kind: result.errorKind ?? "permanent",
  };
}

/** Como queda la fila cuando el intento lanzo. */
export function rowFromFailure(
  error: PublishError,
  platform: string,
  decision: AttemptDecision,
): Partial<PublicationRow> {
  const message = humanizePublishError(error, platform);
  return {
    // Mientras quede un reintento la fila vuelve a "scheduled": la pieza
    // sigue diciendo "programada", que es la verdad. "failed" recien cuando
    // ya no se intenta mas.
    status: decision.action === "retry" ? "scheduled" : "failed",
    last_error: message,
    last_error_kind: error.kind,
  };
}

// ── Lo que escribe ────────────────────────────────────────────────────────

/**
 * Toma la fila para publicar.
 *
 * El `WHERE status = 'scheduled'` es la guarda contra publicar dos veces:
 * la base decide quien se la lleva. Devuelve null si ya no estaba disponible,
 * y eso NO es un error: es la otra corrida haciendo su trabajo.
 */
export async function claimForPublishing(
  supabase: Db,
  socialPostId: string,
): Promise<{ id: string; attempts: number } | null> {
  const { data, error } = await supabase
    .from("social_posts")
    .update({ status: "publishing" })
    .eq("id", socialPostId)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .select("id, attempts")
    .maybeSingle();

  if (error) {
    console.error("[publishing] no pude tomar la publicacion:", error.message);
    return null;
  }
  return data ?? null;
}

export interface PublishDeps {
  /** URLs firmadas de la media, validas mientras dure la subida. */
  signMedia(paths: string[]): Promise<string[]>;
  /** El secreto del publicador, ya resuelto (Vault). */
  credentialsFor(params: {
    publisherId: string;
    workspaceId: string;
    platform: string;
  }): Promise<PublishCredentials>;
}

export interface PublishOutcome {
  kind: "published" | "processing" | "retry" | "failed" | "skipped";
  detail?: string;
}

/**
 * Publica UNA fila de `social_posts`.
 *
 * Devuelve como quedo en vez de lanzar: el job no tiene que reintentar por su
 * cuenta, porque el reintento con su espera lo agenda esta misma funcion.
 * Lanzar haria que la cola reintente a los 10 segundos, encima del reintento
 * propio: dos publicaciones.
 */
export async function runPublication(
  supabase: Db,
  socialPostId: string,
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const claimed = await claimForPublishing(supabase, socialPostId);
  if (!claimed) {
    return { kind: "skipped", detail: "ya no estaba programada" };
  }

  const { data: row } = await supabase
    .from("social_posts")
    .select(
      "id, workspace_id, content_post_id, platform, publisher, attempts, requested_visibility, social_account_id",
    )
    .eq("id", socialPostId)
    .maybeSingle();

  if (!row) {
    return { kind: "skipped", detail: "la publicacion ya no existe" };
  }

  // La cuenta, aparte: el id externo es con que cuenta se publica, y sin el
  // ningun publicador sabe a donde mandar el post.
  const accountRef = await accountRefOf(supabase, row.social_account_id);

  const attempts = (row.attempts ?? 0) + 1;
  await supabase.from("social_posts").update({ attempts }).eq("id", socialPostId);

  try {
    const input = await buildInput(supabase, { ...row, accountRef }, deps);
    const publisher = getPublisher(row.publisher ?? "");
    const credentials = await deps.credentialsFor({
      publisherId: row.publisher ?? "",
      workspaceId: row.workspace_id,
      platform: row.platform,
    });

    const result = await publisher.publish({ input, credentials });
    await supabase
      .from("social_posts")
      .update(rowFromResult(result, new Date()))
      .eq("id", socialPostId);

    if (result.status === "processing") {
      // El webhook puede no llegar nunca (Postproxy no documenta ninguno).
      // La revision es la red de seguridad, no el camino principal.
      await scheduleRecheck(supabase, socialPostId, row.workspace_id, 0);
      return { kind: "processing" };
    }

    if (result.status === "failed") {
      return { kind: "failed", detail: result.error ?? undefined };
    }

    // Le completa el id a la automatizacion que lo esperaba (F39). Va
    // despues de dar por publicada la fila: que falle no puede deshacer una
    // publicacion que ya salio.
    await completePostIds(supabase, {
      workspaceId: row.workspace_id,
      platform: row.platform,
      channelId: await channelIdFor(supabase, row.social_account_id),
      cta: input.options.cta as never,
      externalPostId: result.externalId ?? null,
    });

    await completePostIfDone(supabase, row.content_post_id);
    return { kind: "published", detail: result.warning ?? undefined };
  } catch (err) {
    const error =
      err instanceof UnknownPublisherError
        ? new PublishError(err.message, "permanent")
        : classifyPublishError(err);

    const decision = nextPublishAttempt(attempts, error.kind);
    await supabase
      .from("social_posts")
      .update(rowFromFailure(error, row.platform, decision))
      .eq("id", socialPostId);

    if (decision.action === "retry") {
      await schedulePublish(supabase, socialPostId, row.workspace_id, decision.delayMs);
      return { kind: "retry", detail: `en ${Math.round(decision.delayMs / 60_000)} min` };
    }

    await notifyPublishFailed(supabase, row, error);
    return { kind: "failed", detail: error.message };
  }
}

/** El canal de la bandeja de esa cuenta, si conversa. */
async function channelIdFor(supabase: Db, socialAccountId: string | null): Promise<string | null> {
  if (!socialAccountId) return null;
  const { data } = await supabase
    .from("social_accounts")
    .select("channel_id")
    .eq("id", socialAccountId)
    .maybeSingle();
  return data?.channel_id ?? null;
}

/** El id de la cuenta en la red. */
async function accountRefOf(supabase: Db, socialAccountId: string | null): Promise<string | null> {
  if (!socialAccountId) return null;
  const { data } = await supabase
    .from("social_accounts")
    .select("external_id")
    .eq("id", socialAccountId)
    .maybeSingle();
  return data?.external_id ?? null;
}

/**
 * Arma lo que se le manda al publicador desde la pieza.
 *
 * El caption y la media salen de `resolveNetworkContent`, el mismo resolutor
 * que usa el editor: si la red tiene variante propia se publica la variante,
 * y si no, lo base. Que el editor muestre una cosa y se publique otra seria
 * el peor error posible de este modulo.
 */
async function buildInput(
  supabase: Db,
  row: {
    content_post_id: string | null;
    platform: string;
    requested_visibility: string | null;
    accountRef: string | null;
  },
  deps: PublishDeps,
): Promise<PublishInput> {
  const { data: post } = row.content_post_id
    ? await supabase
        .from("content_posts")
        .select("title, caption, media, networks")
        .eq("id", row.content_post_id)
        .maybeSingle()
    : { data: null };

  const baseMedia = (Array.isArray(post?.media) ? post.media : []) as unknown as MediaEntry[];
  const networks = (Array.isArray(post?.networks) ? post.networks : []) as unknown as NetworkEntry[];
  const network: NetworkEntry = networks.find((n) => n.platform === row.platform) ?? {
    platform: row.platform,
  };

  const resolved = resolveNetworkContent<MediaEntry>({
    network,
    baseCaption: post?.caption ?? null,
    baseMedia,
  });

  const live = liveMedia(resolved.media);
  const urls = live.length > 0 ? await deps.signMedia(live.map((m) => m.storage_path)) : [];

  return {
    platform: row.platform,
    text: resolved.caption,
    title: network.youtube_title ?? post?.title ?? null,
    media: live,
    mediaUrls: urls,
    options: {
      ...(network.options ?? {}),
      ...(row.requested_visibility ? { visibility: row.requested_visibility } : {}),
      // El CTA viaja con las opciones para que el despachador pueda
      // completarle el id a la automatizacion despues de publicar (F39).
      // Ningun publicador lo mira.
      ...(network.cta ? { cta: network.cta } : {}),
    },
    accountRef: row.accountRef,
  };
}

async function schedulePublish(supabase: Db, socialPostId: string, workspaceId: string, delayMs: number) {
  try {
    await scheduleJob(
      supabase,
      CONTENT_PUBLISH_JOB,
      { socialPostId, workspaceId },
      new Date(Date.now() + delayMs),
    );
  } catch (err) {
    console.error("[publishing] no pude agendar el reintento:", err);
  }
}

async function scheduleRecheck(supabase: Db, socialPostId: string, workspaceId: string, checks: number) {
  const delay = nextRecheckDelay(checks);
  if (delay === null) return;
  try {
    await scheduleJob(
      supabase,
      CONTENT_PUBLISH_CHECK_JOB,
      { socialPostId, workspaceId, checks: checks + 1 },
      new Date(Date.now() + delay),
    );
  } catch (err) {
    console.error("[publishing] no pude agendar la revision:", err);
  }
}

/**
 * Vuelve a preguntar por una que quedo en proceso.
 *
 * Si el publicador no sabe preguntar, o sigue sin saberse, se reagenda hasta
 * que se acaben las revisiones. Al final queda fallida con un motivo claro:
 * mejor que quede "no se pudo confirmar" a que quede "publicando" para
 * siempre.
 */
export async function runPublicationCheck(
  supabase: Db,
  params: { socialPostId: string; workspaceId: string; checks: number },
  deps: Pick<PublishDeps, "credentialsFor">,
): Promise<PublishOutcome> {
  const { data: row } = await supabase
    .from("social_posts")
    .select("id, workspace_id, content_post_id, platform, publisher, publisher_ref, status")
    .eq("id", params.socialPostId)
    .maybeSingle();

  if (!row || row.status !== "publishing") {
    return { kind: "skipped", detail: "ya se resolvio" };
  }
  if (!row.publisher_ref) {
    return { kind: "skipped", detail: "sin referencia del proveedor" };
  }

  let publisher;
  try {
    publisher = getPublisher(row.publisher ?? "");
  } catch {
    return { kind: "skipped", detail: "sin publicador" };
  }

  if (!publisher.getStatus) {
    return { kind: "skipped", detail: "ese publicador no sabe preguntar" };
  }

  try {
    const credentials = await deps.credentialsFor({
      publisherId: row.publisher ?? "",
      workspaceId: row.workspace_id,
      platform: row.platform,
    });
    const result = await publisher.getStatus({
      ref: row.publisher_ref,
      platform: row.platform,
      credentials,
    });

    if (result.status === "processing") {
      const delay = nextRecheckDelay(params.checks);
      if (delay === null) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            last_error:
              "No pude confirmar si salio. Fijate en la red antes de volver a publicar, para no duplicarla.",
            last_error_kind: "permanent",
          })
          .eq("id", row.id);
        return { kind: "failed", detail: "sin confirmacion" };
      }
      await scheduleRecheck(supabase, row.id, row.workspace_id, params.checks);
      return { kind: "processing" };
    }

    await supabase.from("social_posts").update(rowFromResult(result, new Date())).eq("id", row.id);
    if (result.status === "published") {
      await completePostIfDone(supabase, row.content_post_id);
      return { kind: "published" };
    }
    return { kind: "failed", detail: result.error ?? undefined };
  } catch (err) {
    const error = classifyPublishError(err);
    // Una revision que falla no gasta intentos de publicacion: no se publico
    // nada de nuevo, solo no se pudo preguntar.
    const delay = nextRecheckDelay(params.checks);
    if (delay !== null) {
      await scheduleRecheck(supabase, row.id, row.workspace_id, params.checks);
      return { kind: "processing", detail: error.message };
    }
    return { kind: "failed", detail: error.message };
  }
}

/**
 * Marca la pieza como publicada si ya salieron todas sus redes.
 *
 * Tambien completa `triggers.config.postIds` de las automatizaciones por
 * comentario, que es lo que hace que un flow escuche el post recien salido
 * sin que nadie tenga que pegar el id a mano (F39).
 */
export async function completePostIfDone(supabase: Db, contentPostId: string | null) {
  if (!contentPostId) return;

  const { data: rows } = await supabase
    .from("social_posts")
    .select("status")
    .eq("content_post_id", contentPostId)
    .is("deleted_at", null);

  const status = aggregatePostStatus(rows ?? []);
  await supabase.from("content_posts").update({ status }).eq("id", contentPostId);
}

/** Aviso de que una publicacion no salio (F37). */
async function notifyPublishFailed(
  supabase: Db,
  row: { workspace_id: string; content_post_id: string | null; platform: string },
  error: PublishError,
) {
  try {
    await notifyPublishFailure(supabase, {
      workspaceId: row.workspace_id,
      contentPostId: row.content_post_id,
      platform: row.platform,
      reason: humanizePublishError(error, row.platform),
    });
  } catch (err) {
    // Un aviso que no sale no puede cambiar el resultado de la publicacion.
    console.error("[publishing] no pude avisar de la falla:", err);
  }
}
