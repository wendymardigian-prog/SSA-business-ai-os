/**
 * Los tipos de job del pipeline de contenido.
 *
 * Viven aparte de las Server Actions porque en un archivo "use server" todo
 * lo exportado tiene que ser una funcion asincrona, y ademas los necesitan
 * tanto quien encola como quien despacha (el registro del bloque 4b).
 */

/** Publica una red a su hora. Payload: { socialPostId, workspaceId }. */
export const CONTENT_PUBLISH_JOB = "content_publish";

/**
 * Publica una red cuya subida es larga (A17). Mismo payload y mismo handler
 * que `content_publish`; lo unico que cambia es QUIEN lo corre.
 *
 * Subir un video a YouTube por trozos puede tardar minutos. Dentro del cron
 * general, esos minutos se los come toda la cola: los 19 jobs que venian
 * detras esperan. Por eso va a su propia ruta, con su propio limite de
 * tiempo.
 */
export const CONTENT_UPLOAD_JOB = "content_upload";

/**
 * Agenda la publicacion del lado del proveedor (D1).
 *
 * Sube la media a Zernio y crea el post con su fecha. Corre en la ruta de
 * las subidas largas porque puede tardar lo mismo: un video de 200 MB.
 */
export const CONTENT_PROVIDER_SCHEDULE_JOB = "content_provider_schedule";

/** Vuelve a preguntar por una publicacion que quedo en proceso. */
export const CONTENT_PUBLISH_CHECK_JOB = "content_publish_check";

/** Genera el guion y los captions con IA. Payload: { postId, workspaceId }. */
export const CONTENT_COPY_JOB = "content_copy";

/**
 * Que publicadores suben el archivo ellos mismos, y por eso tardan.
 *
 * Zernio y Postproxy reciben una URL y bajan el archivo de su lado: para
 * nosotros son una llamada corta.
 */
export const SLOW_UPLOAD_PUBLISHERS = ["youtube_api"] as const;

export function jobTypeForPublisher(publisher: string | null | undefined): string {
  return SLOW_UPLOAD_PUBLISHERS.includes(publisher as never)
    ? CONTENT_UPLOAD_JOB
    : CONTENT_PUBLISH_JOB;
}

/** Los que corren en /api/cron/content-upload, de a uno y con mas tiempo. */
export const SLOW_JOB_TYPES = [CONTENT_UPLOAD_JOB, CONTENT_PROVIDER_SCHEDULE_JOB] as const;

export const CONTENT_JOB_TYPES = [
  CONTENT_PUBLISH_JOB,
  CONTENT_UPLOAD_JOB,
  CONTENT_PROVIDER_SCHEDULE_JOB,
  CONTENT_PUBLISH_CHECK_JOB,
  CONTENT_COPY_JOB,
] as const;
