/**
 * Cruzar el hilo de Instagram con lo que guardamos nosotros (F14).
 *
 * El hilo de Instagram se lee EN VIVO de la API de Zernio, no de nuestra tabla
 * (para WhatsApp y email es al revés). Eso no cambia: Zernio es la fuente del
 * hilo y del orden.
 *
 * Pero Zernio no sabe nada de la media que copiamos a nuestro Storage, ni de las
 * transcripciones: devuelve su array crudo de adjuntos con URLs del CDN de Meta
 * que ya vencieron. Asi que se cruza por `platform_message_id` y cada mensaje se
 * enriquece con lo nuestro.
 *
 * El cruce mira LAS DOS columnas de id. El endpoint de historial de Zernio
 * devolvia antes su propio id (el mismo que manda el webhook y que guardamos en
 * `platform_message_id`), pero hoy devuelve el de Meta (`aWdf...`), que el
 * webhook trae aparte y guardamos en `platform_native_message_id`. Cruzar solo
 * por la primera dejaba toda la media de Instagram como "ya no disponible"
 * aunque el archivo estuviera en nuestro Storage (14/10/2026). Mismo criterio
 * que `lib/backfill-messages.ts` y `lib/agent/refresh.ts`.
 *
 * Tambien se reemplaza el `id`: el de Zernio no sirve para pedir una
 * transcripcion, porque nuestras rutas trabajan con el id de la fila. Un mensaje
 * sin fila local conserva el de Zernio, que es lo unico que hay.
 *
 * Modulo PURO.
 */

import type { InboxMessage } from "./zernio-message";

/** Lo que aporta nuestra tabla. */
export interface LocalMessageMedia {
  id: string;
  platform_message_id: string | null;
  platform_native_message_id: string | null;
  attachments: unknown;
  transcript: string | null;
  transcript_status: string | null;
  transcript_error: string | null;
  media_description: string | null;
  /**
   * De donde vino el mensaje (00189): anuncio, historia, pieza. Opcional en el tipo para que las filas anteriores al
   * Extra I (F44) sigan siendo validas; sin el dato, el mensaje no lleva el chip "Vino de".
   */
  origin_context?: unknown;
}

/**
 * Un mensaje del hilo, ya enriquecido.
 *
 * `attachments` se saca del tipo de Zernio y se vuelve a declarar: alla es un
 * array (su formato crudo), y aca puede ser el objeto `{v:2, items}` que
 * guardamos nosotros.
 */
export type MergedInboxMessage = Omit<InboxMessage, "attachments"> & {
  attachments: unknown;
  transcript: string | null;
  transcript_status: string | null;
  transcript_error: string | null;
  media_description: string | null;
  origin_context: unknown;
};

/**
 * El hilo de Zernio, con nuestros datos encima.
 *
 * Lo que NO hace, a proposito:
 *
 *   - No cambia el orden ni agrega mensajes. Si un mensaje esta en nuestra tabla
 *     y no en el hilo de Zernio, no se muestra: el hilo lo manda Zernio, y meter
 *     filas sueltas dejaria la conversacion en un orden que no es el real.
 *   - No borra los adjuntos de Zernio cuando no hay fila local. Una
 *     conversacion anterior al guardado (o un mensaje que no se pudo guardar) no
 *     tiene fila, y la bandeja tiene que seguir mostrando lo que trae Zernio (aunque el link este vencido, la
 *     burbuja al menos dice que llego un adjunto).
 */
export function mergeThreadWithLocal(
  thread: InboxMessage[],
  local: LocalMessageMedia[],
): MergedInboxMessage[] {
  // Las dos columnas al mismo mapa: el id que trae el hilo puede ser
  // cualquiera de los dos (ver la cabecera).
  const byPlatformId = new Map<string, LocalMessageMedia>();
  for (const row of local) {
    if (row.platform_native_message_id) byPlatformId.set(row.platform_native_message_id, row);
  }
  for (const row of local) {
    if (row.platform_message_id) byPlatformId.set(row.platform_message_id, row);
  }

  return thread.map((message) => {
    const match = message.platform_message_id ? byPlatformId.get(message.platform_message_id) : undefined;

    if (!match) {
      return {
        ...message,
        // Sin fila local queda lo que trajo Zernio: el parser lo lee como el
        // formato viejo y la burbuja muestra "ya no disponible".
        attachments: message.attachments,
        transcript: null,
        transcript_status: null,
        transcript_error: null,
        media_description: null,
        origin_context: null,
      };
    }

    return {
      ...message,
      // El id local: es el que entienden /api/v1/messages/[id]/transcribe y la
      // ruta de reintento de descarga.
      id: match.id,
      // Los adjuntos NUESTROS, que son los que tienen el archivo adentro.
      attachments: match.attachments,
      transcript: match.transcript,
      transcript_status: match.transcript_status,
      transcript_error: match.transcript_error,
      media_description: match.media_description,
      // El origen vive solo en nuestra tabla (Zernio no lo conoce): se cruza igual que la media (Extra I, F44).
      origin_context: match.origin_context ?? null,
    };
  });
}

/** Los ids de Zernio de un hilo, para la consulta del cruce. */
export function platformIdsOf(thread: InboxMessage[]): string[] {
  return [...new Set(thread.map((m) => m.platform_message_id).filter((id): id is string => Boolean(id)))];
}
