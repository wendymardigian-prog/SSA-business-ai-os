/**
 * Los jobs del pipeline de contenido (F35).
 *
 * Son finitos a proposito: leen el payload, arman de donde salen la media
 * firmada y las claves, y le pasan el trabajo al despachador. Toda la
 * decision vive en `lib/publishing/dispatcher.ts`, que se prueba sin base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  CONTENT_PROVIDER_SCHEDULE_JOB,
  CONTENT_PUBLISH_CHECK_JOB,
  CONTENT_PUBLISH_JOB,
  CONTENT_UPLOAD_JOB,
} from "@/lib/content/jobs";
import { runProviderSchedule } from "@/lib/publishing/provider-dispatch";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { credentialsForPublisher } from "@/lib/publishing/credentials";
import { runPublication, runPublicationCheck, type PublishDeps } from "@/lib/publishing/dispatcher";

const BUCKET = "content-media";

/**
 * Cuanto viven las URLs firmadas de la media.
 *
 * 24 horas: una subida de video a YouTube puede tardar, y que el link se
 * venza a la mitad significa empezar de cero.
 */
const SIGNED_URL_SECONDS = 24 * 60 * 60;

type Db = SupabaseClient<Database>;

export function publishDeps(supabase: Db, workspaceId: string): PublishDeps {
  return {
    async signMedia(paths) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_SECONDS);

      if (error) {
        throw new Error(`No pude preparar la media para publicar: ${error.message}`);
      }

      // Si falta una sola, no se publica: una pieza con la mitad de las fotos
      // es peor que una que no salio.
      const urls = (data ?? []).map((entry) => entry.signedUrl);
      if (urls.length !== paths.length || urls.some((u) => !u)) {
        throw new Error("No pude preparar toda la media para publicar");
      }
      return urls;
    },

    credentialsFor: ({ publisherId }) =>
      credentialsForPublisher(supabase, { publisherId, workspaceId }),
  };
}

interface PublishPayload {
  socialPostId?: string;
  workspaceId?: string;
  checks?: number;
}

async function handlePublish({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as PublishPayload;
  if (!payload.socialPostId || !payload.workspaceId) {
    // Sin payload no hay nada que reintentar: el job falla y se ve.
    throw new Error(`job ${job.id} de publicacion sin socialPostId o workspaceId`);
  }

  const outcome = await runPublication(
    supabase,
    payload.socialPostId,
    publishDeps(supabase, payload.workspaceId),
  );

  // Sin el caption ni el link: el log no lleva el contenido de la pieza.
  console.log(
    `[cron/jobs] publicacion ${payload.socialPostId}: ${outcome.kind}${outcome.detail ? ` (${outcome.detail})` : ""}`,
  );
}

async function handlePublishCheck({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as PublishPayload;
  if (!payload.socialPostId || !payload.workspaceId) {
    throw new Error(`job ${job.id} de revision sin socialPostId o workspaceId`);
  }

  const outcome = await runPublicationCheck(
    supabase,
    {
      socialPostId: payload.socialPostId,
      workspaceId: payload.workspaceId,
      checks: typeof payload.checks === "number" ? payload.checks : 0,
    },
    publishDeps(supabase, payload.workspaceId),
  );

  console.log(`[cron/jobs] revision ${payload.socialPostId}: ${outcome.kind}`);
}

/**
 * Deja el post agendado en el proveedor (D1).
 *
 * Sube la media y crea el post con su fecha. No espera a la hora de salida:
 * eso lo hace Zernio.
 */
async function handleProviderSchedule({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as PublishPayload;
  if (!payload.socialPostId || !payload.workspaceId) {
    throw new Error(`job ${job.id} de agenda sin socialPostId o workspaceId`);
  }

  const outcome = await runProviderSchedule(
    supabase,
    payload.socialPostId,
    publishDeps(supabase, payload.workspaceId),
  );
  console.log(
    `[cron/content-upload] agenda ${payload.socialPostId}: ${outcome.kind}${outcome.detail ? ` (${outcome.detail})` : ""}`,
  );
}

export function registerContentPublishHandlers(): void {
  registerJobHandler(CONTENT_PUBLISH_JOB, handlePublish);
  // El mismo trabajo, en su propia ruta: lo unico que cambia es quien lo
  // corre y con cuanto tiempo (A17).
  registerJobHandler(CONTENT_UPLOAD_JOB, handlePublish);
  registerJobHandler(CONTENT_PROVIDER_SCHEDULE_JOB, handleProviderSchedule);
  registerJobHandler(CONTENT_PUBLISH_CHECK_JOB, handlePublishCheck);
}
