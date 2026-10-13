/**
 * El job que baja las miniaturas de los anuncios de UNA cuenta (Extra L, AT2, F24).
 *
 * Toda la logica esta en `lib/meta/thumbnails.ts`. Este handler solo valida el payload: ni
 * este ni ese lanzan por un fallo de la red o de Meta (la cola reintentaria a los 10
 * segundos encima del reintento propio).
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { META_AD_THUMBNAILS_JOB, runThumbnailBatch, type JobPayload } from "@/lib/meta/thumbnails";

async function handleMetaAdThumbnails({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as JobPayload;
  if (!payload.workspaceId || !payload.adAccountId) {
    throw new Error(`job ${job.id} de miniaturas sin workspaceId o adAccountId`);
  }

  const result = await runThumbnailBatch(supabase, { workspaceId: payload.workspaceId, adAccountId: payload.adAccountId });
  console.log(`[meta-ads] miniaturas ${payload.adAccountId}: ${result.saved} guardadas, ${result.failed} fallidas`);
}

export function registerMetaAdThumbnailsHandler(): void {
  registerJobHandler(META_AD_THUMBNAILS_JOB, handleMetaAdThumbnails);
}
