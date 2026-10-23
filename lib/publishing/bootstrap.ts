/**
 * Enchufar los publicadores y los handlers de job (F30, F35).
 *
 * Un solo lugar que se importa una vez desde el runner. Registrar al
 * importar cada modulo tendria el mismo efecto solo si alguien lo importa, y
 * un publicador que nadie importo es una publicacion que falla en
 * produccion y anda en los tests.
 *
 * Es idempotente: registrar dos veces deja lo mismo.
 */

import { registerPublisher } from "./registry";
import { zernioPublisher } from "./zernio";
import { postproxyPublisher } from "./postproxy";
import { linkedinPublisher } from "./linkedin";
import { threadsPublisher } from "./threads";
import { createYouTubePublisher, CHUNK_BYTES } from "./youtube";
import { registerContentPublishHandlers } from "@/lib/jobs/handlers/content-publish";
import { registerContentCopyHandler } from "@/lib/jobs/handlers/content-copy";
import { registerMetricsHandlers } from "@/lib/jobs/handlers/metrics-sync";
import { registerMetaAdsHandlers } from "@/lib/jobs/handlers/meta-ads-sync";
import { registerMetaAdThumbnailsHandler } from "@/lib/jobs/handlers/meta-ad-thumbnails";
import { registerZernioAdOriginHandler } from "@/lib/jobs/handlers/zernio-ad-origin";
import { registerBookingJobHandlers } from "@/lib/jobs/handlers/booking-sync";
import { registerBookingRelativeHandler } from "@/lib/jobs/handlers/booking-relative";
import { registerFlowWaitTimeoutHandler } from "@/lib/jobs/handlers/flow-wait-timeout";
import { registerBgTaskHandler } from "@/lib/jobs/handlers/bg-task";
import { registerTranscribeAudioHandler } from "@/lib/jobs/handlers/transcribe-audio";
import { registerDescribeMediaHandler } from "@/lib/jobs/handlers/describe-media";
import { registerFathomSyncHandler } from "@/lib/jobs/handlers/fathom-sync";
import { registerCallClassifyHandler } from "@/lib/jobs/handlers/call-classify";
import { registerCallAnalyzeHandler } from "@/lib/jobs/handlers/call-analyze";
import { registerCallSummaryHandler } from "@/lib/jobs/handlers/call-summary";
import { registerCallIndexKnowledgeHandler } from "@/lib/jobs/handlers/call-index-knowledge";
import { registerContractPdfHandler } from "@/lib/jobs/handlers/contract-pdf";
import { registerSalesContactEvalHandler } from "@/lib/jobs/handlers/sales-contact-eval";
import { registerPaymentsOverdueSweepHandler } from "@/lib/jobs/handlers/payments-overdue-sweep";
import { registerTasksDueSweepHandler } from "@/lib/jobs/handlers/tasks-due-sweep";
import { registerFinanceDailyHandler } from "@/lib/jobs/handlers/finance-daily";
import { registerCommentBackfillHandlers } from "@/lib/jobs/handlers/comment-backfill";
import { registerCommissionsPaymentHandler } from "@/lib/jobs/handlers/commissions-payment";
import { registerEodReminderHandler } from "@/lib/jobs/handlers/eod-reminder";
import { registerPaymentRelativeHandler } from "@/lib/jobs/handlers/payment-relative";
import { registerContractEmailHandler } from "@/lib/jobs/handlers/contract-email";

/**
 * Lee el video por rangos desde la URL firmada.
 *
 * `Range` sobre la URL firmada de Storage: nunca entra el archivo entero en
 * memoria, que es la unica forma de subir un video de 800 MB desde un
 * contenedor chico.
 */
export function signedUrlReader(fetchImpl: typeof fetch = fetch) {
  return async (url: string) => {
    const head = await fetchImpl(url, { method: "HEAD" });
    if (!head.ok) {
      throw new Error(`No pude leer el video para subirlo (${head.status})`);
    }
    const sizeBytes = Number(head.headers.get("content-length") ?? 0);
    if (!sizeBytes) {
      throw new Error("No pude saber cuanto pesa el video");
    }

    return {
      sizeBytes,
      contentType: head.headers.get("content-type") ?? "video/mp4",
      read: async (start: number, end: number) => {
        const part = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (!part.ok) {
          throw new Error(`No pude leer el video para subirlo (${part.status})`);
        }
        return part.arrayBuffer();
      },
    };
  };
}

let done = false;

export function registerPublishing(): void {
  if (done) return;
  done = true;

  registerPublisher(zernioPublisher);
  registerPublisher(postproxyPublisher);
  registerPublisher(linkedinPublisher);
  registerPublisher(threadsPublisher);
  registerPublisher(
    createYouTubePublisher({ createReader: signedUrlReader(), chunkBytes: CHUNK_BYTES }),
  );

  registerContentPublishHandlers();
  registerContentCopyHandler();
  registerMetricsHandlers();
  registerMetaAdsHandlers();
  registerMetaAdThumbnailsHandler();
  // El anuncio de origen de una conversacion de Instagram, desde Zernio (Tiron 2, A1).
  registerZernioAdOriginHandler();
  // Agenda (Etapa 4): crear/mover/borrar el evento en Google y el fin de agenda.
  registerBookingJobHandlers();
  // Los avisos relativos a la hora de la reunion (F44).
  registerBookingRelativeHandler();
  // El vencimiento de un "Esperar respuesta" (auditoria de automatizaciones).
  registerFlowWaitTimeoutHandler();

  // Las tareas de IA en segundo plano (F24). Despacha por `payload.task`: una
  // tarea sin implementacion falla con el motivo, no completa en silencio.
  registerBgTaskHandler();

  // Mejoras de Chat: pasar a texto las notas de voz, para que el agente sepa
  // que le dijeron (F7).
  registerTranscribeAudioHandler();

  // Y describir las imagenes, para que una captura no sea un mensaje vacio (F8).
  registerDescribeMediaHandler();

  // Llamadas: la consulta a Fathom de una conexion (F8).
  registerFathomSyncHandler();
  registerCallClassifyHandler();
  registerCallAnalyzeHandler();
  registerCallSummaryHandler();
  registerCallIndexKnowledgeHandler();

  // Formularios: el PDF firmado de un contrato y su copia por email (F27, F28).
  registerContractPdfHandler();
  registerContractEmailHandler();

  // Ventas: la asignacion automatica de setter, vendedor y referido (F15).
  registerSalesContactEvalHandler();
  registerPaymentsOverdueSweepHandler();
  registerTasksDueSweepHandler();
  registerFinanceDailyHandler();
  registerCommentBackfillHandlers();
  registerCommissionsPaymentHandler();
  // Reporte de fin de día (E13): el recordatorio.
  registerEodReminderHandler();
  registerPaymentRelativeHandler();
}

/** Para los tests. */
export function resetPublishingBootstrap(): void {
  done = false;
}
