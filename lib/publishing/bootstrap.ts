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
import { registerJobHandler } from "@/lib/jobs/registry";
import { registerBookingJobHandlers } from "@/lib/jobs/handlers/booking-sync";

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
  // Agenda (Etapa 4): crear/mover/borrar el evento en Google y el fin de agenda.
  registerBookingJobHandlers();

  // `bg_task` no hace nada, y sigue sin hacerlo. Un handler explicito, en vez
  // del default: asi el runner puede fallar los tipos que no conoce sin
  // fallar este, que se encola solo.
  registerJobHandler("bg_task", async () => {});
}

/** Para los tests. */
export function resetPublishingBootstrap(): void {
  done = false;
}
