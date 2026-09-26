/**
 * Los tipos de job del pipeline de contenido.
 *
 * Viven aparte de las Server Actions porque en un archivo "use server" todo
 * lo exportado tiene que ser una funcion asincrona, y ademas los necesitan
 * tanto quien encola como quien despacha (el registro del bloque 4b).
 */

/** Publica una red a su hora. Payload: { socialPostId, workspaceId }. */
export const CONTENT_PUBLISH_JOB = "content_publish";

/** Vuelve a preguntar por una publicacion que quedo en proceso. */
export const CONTENT_PUBLISH_CHECK_JOB = "content_publish_check";

/** Genera el guion y los captions con IA. Payload: { postId, workspaceId }. */
export const CONTENT_COPY_JOB = "content_copy";

export const CONTENT_JOB_TYPES = [
  CONTENT_PUBLISH_JOB,
  CONTENT_PUBLISH_CHECK_JOB,
  CONTENT_COPY_JOB,
] as const;
