/**
 * El job que recupera el anuncio de origen de una conversación de Instagram desde Zernio (Extra L, Tirón 2, A1).
 *
 * Toda la lógica está en `lib/meta/zernio-ad-origin.ts`. Este handler solo valida el payload: ni este ni aquel lanzan por
 * un fallo de Zernio (la cola reintentaría a los 10 segundos encima del reintento propio de 1, 5 y 15 minutos).
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runZernioAdOrigin, ZERNIO_AD_ORIGIN_JOB, type AdOriginPayload } from "@/lib/meta/zernio-ad-origin";

async function handleZernioAdOrigin({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<AdOriginPayload>;
  if (!payload.workspaceId || !payload.contactId || !payload.conversationId || !payload.lateConversationId || !payload.lateAccountId || !payload.platformMessageId || !payload.messageAt) {
    throw new Error(`job ${job.id} del anuncio de origen con el payload incompleto`);
  }

  const outcome = await runZernioAdOrigin(supabase, payload as AdOriginPayload);
  console.log(`[atribucion] anuncio de origen de la conversacion ${payload.conversationId}: ${outcome}`);
}

export function registerZernioAdOriginHandler(): void {
  registerJobHandler(ZERNIO_AD_ORIGIN_JOB, handleZernioAdOrigin);
}
