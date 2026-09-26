/**
 * El job que sincroniza las metricas de UNA cuenta (F47).
 *
 * Una cuenta por job, no todas juntas: si Threads tarda dos minutos, eso no
 * puede dejar a Instagram sin sincronizar. Cada una falla o sale por su
 * cuenta, y el error queda escrito donde se ve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { readSecret, SECRET_NAMES, oauthSecretName } from "@/lib/vault";
import { readZernioMetrics } from "@/lib/metrics/zernio";
import { readThreadsMetrics } from "@/lib/metrics/threads";
import { readYouTubeMetrics } from "@/lib/metrics/youtube";
import { readReachBreakdown } from "@/lib/meta/instagram-graph";
import { getMetaToken } from "@/lib/meta/token";
import { parseMetaConfig } from "@/lib/meta/accounts";
import {
  markAccountSync,
  persistAccountMetrics,
  persistPosts,
  syncDate,
} from "@/lib/metrics/sync";
import { DAILY_UNTIL_DAYS } from "@/lib/metrics/rules";
import { EMPTY_READER_RESULT, type ReaderResult } from "@/lib/metrics/types";
import { canReadComments, readThreadsReplies, readYouTubeComments, readZernioComments } from "@/lib/comments/sync";
import { storeComment } from "@/lib/comments/store";
import { createZernioClient } from "@/lib/zernio-client";

type Db = SupabaseClient<Database>;

export const METRICS_SYNC_JOB = "metrics_sync";

export interface MetricsSyncPayload {
  workspaceId?: string;
  socialAccountId?: string;
}

/** El token OAuth de una conexion del workspace. */
async function oauthToken(supabase: Db, workspaceId: string, provider: string): Promise<string | null> {
  const { data } = await supabase
    .from("oauth_connections")
    .select("vault_secret_prefix")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider as never)
    .is("user_id", null)
    .maybeSingle();

  if (!data) return null;
  return readSecret(supabase, workspaceId, oauthSecretName(data.vault_secret_prefix, "access_token"));
}

/**
 * Lee la cuenta con el lector que corresponde a su red.
 *
 * Devuelve el resultado vacio con un aviso cuando falta la conexion: que una
 * cuenta no tenga token no es una falla del job, es una cuenta por conectar.
 */
async function readAccount(
  supabase: Db,
  account: {
    id: string;
    workspace_id: string;
    platform: string;
    external_id: string | null;
    channel_id: string | null;
  },
  fromDate: string,
  toDate: string,
): Promise<ReaderResult> {
  switch (account.platform) {
    case "instagram":
    case "tiktok": {
      const key = await getZernioApiKey(account.workspace_id, { supabase: supabase as never });
      if (!key) return { ...EMPTY_READER_RESULT, warnings: ["Falta la clave de Zernio"] };

      // El id de la cuenta EN ZERNIO vive en el canal de la bandeja; para
      // TikTok, que no conversa, es el external_id de la cuenta social.
      let zernioAccountId = account.external_id;
      if (account.channel_id) {
        const { data: channel } = await supabase
          .from("channels")
          .select("late_account_id")
          .eq("id", account.channel_id)
          .maybeSingle();
        zernioAccountId = channel?.late_account_id ?? zernioAccountId;
      }
      if (!zernioAccountId) {
        return { ...EMPTY_READER_RESULT, warnings: ["La cuenta no tiene id de Zernio"] };
      }

      return readZernioMetrics({
        apiKey: key,
        accountId: zernioAccountId,
        platform: account.platform,
        fromDate,
        toDate,
      });
    }

    case "threads": {
      const token = await oauthToken(supabase, account.workspace_id, "threads");
      if (!token || !account.external_id) {
        return { ...EMPTY_READER_RESULT, warnings: ["Threads no esta conectado"] };
      }
      return readThreadsMetrics({ token, userId: account.external_id });
    }

    case "youtube": {
      const token = await oauthToken(supabase, account.workspace_id, "google");
      if (!token || !account.external_id) {
        return { ...EMPTY_READER_RESULT, warnings: ["YouTube no esta conectado"] };
      }
      return readYouTubeMetrics({
        token,
        channelId: account.external_id,
        startDate: fromDate,
        endDate: toDate,
      });
    }

    case "linkedin":
      // LinkedIn no da metricas de posts sin partnership. Se dice y se sigue.
      return {
        ...EMPTY_READER_RESULT,
        warnings: ["LinkedIn no permite leer metricas de publicaciones desde afuera."],
      };

    default:
      return EMPTY_READER_RESULT;
  }
}

/**
 * Completa el alcance por tipo de seguidor de los posts de Instagram.
 *
 * Solo lo da la Graph de Meta, y solo si hay token. Sin el, las metricas de
 * Instagram estan igual: falta una columna de `extra`, no la fila.
 */
async function enrichInstagramReach(
  supabase: Db,
  workspaceId: string,
  result: ReaderResult,
): Promise<void> {
  const token = await getMetaToken(supabase, workspaceId);
  if (!token) return;

  for (const post of result.posts) {
    const breakdown = await readReachBreakdown({ mediaId: post.externalPostId, token });
    if (!breakdown) continue;
    post.metrics.extra = {
      ...post.metrics.extra,
      reach_followers: breakdown.followers,
      reach_non_followers: breakdown.nonFollowers,
    };
  }
}

/** Vuelve a leer los comentarios de los posts recientes. */
async function syncComments(
  supabase: Db,
  account: { id: string; workspace_id: string; platform: string; external_id: string | null },
  posts: Array<{ externalPostId: string }>,
): Promise<string[]> {
  if (!canReadComments(account.platform)) return [];

  const warnings: string[] = [];

  for (const post of posts) {
    let read: Awaited<ReturnType<typeof readZernioComments>> = { comments: [], warnings: [] };

    if (account.platform === "instagram" || account.platform === "tiktok") {
      const key = await getZernioApiKey(account.workspace_id, { supabase: supabase as never });
      if (!key || !account.external_id) continue;
      read = await readZernioComments({
        client: createZernioClient(key),
        postId: post.externalPostId,
        accountId: account.external_id,
        platform: account.platform,
      });
    } else if (account.platform === "threads") {
      const token = await oauthToken(supabase, account.workspace_id, "threads");
      if (!token) continue;
      read = await readThreadsReplies({ token, postId: post.externalPostId });
    } else if (account.platform === "youtube") {
      const token = await oauthToken(supabase, account.workspace_id, "google");
      if (!token) continue;
      read = await readYouTubeComments({
        token,
        videoId: post.externalPostId,
        channelId: account.external_id,
      });
    }

    warnings.push(...read.warnings);

    for (const comment of read.comments) {
      await storeComment(supabase, {
        workspaceId: account.workspace_id,
        socialAccountId: account.id,
        comment,
      });
    }
  }

  return warnings;
}

async function handleMetricsSync({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as MetricsSyncPayload;
  if (!payload.socialAccountId || !payload.workspaceId) {
    throw new Error(`job ${job.id} de metricas sin socialAccountId o workspaceId`);
  }

  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, workspace_id, platform, external_id, channel_id")
    .eq("id", payload.socialAccountId)
    .maybeSingle();

  if (!account) {
    console.log(`[metricas] la cuenta ${payload.socialAccountId} ya no existe`);
    return;
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", account.workspace_id)
    .maybeSingle();

  const now = new Date();
  const date = syncDate(now, workspace?.timezone ?? null);

  // Solo la ventana que todavia cambia: pedirle a la API los mil posts
  // historicos cada noche quema la cuota y no aporta un dato (F45).
  const fromDate = new Date(now.getTime() - DAILY_UNTIL_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const result = await readAccount(supabase, account, fromDate, date);

  if (account.platform === "instagram") {
    await enrichInstagramReach(supabase, account.workspace_id, result);
  }

  const persisted = await persistPosts(supabase, {
    workspaceId: account.workspace_id,
    socialAccountId: account.id,
    platform: account.platform,
    posts: result.posts,
    date,
    now,
  });

  for (const snapshot of result.accountDaily) {
    await persistAccountMetrics(supabase, {
      workspaceId: account.workspace_id,
      socialAccountId: account.id,
      date,
      snapshot,
    });
  }

  const commentWarnings = await syncComments(supabase, account, result.posts);

  await markAccountSync(supabase, {
    socialAccountId: account.id,
    now,
    error: [...result.warnings, ...persisted.warnings, ...commentWarnings][0] ?? null,
  });

  // Sin captions ni textos: el log no lleva el contenido de las piezas.
  console.log(
    `[metricas] ${account.platform}: ${persisted.publications} publicaciones, ` +
      `${persisted.metricRows} filas, ${persisted.created} nuevas`,
  );
}

export function registerMetricsHandlers(): void {
  registerJobHandler(METRICS_SYNC_JOB, handleMetricsSync);
}
