/**
 * Qué pueden leer los lectores de vista previa de `robots.txt`.
 *
 * La regla general sigue bloqueando todo. Sin esta excepción, LinkedIn y X no arman la
 * tarjeta de un link de agenda o de un formulario, porque respetan el bloqueo. Las páginas
 * siguen con su `noindex`, y `/calendario/agenda/` queda cerrado: ahí la URL es una credencial.
 *
 * Módulo sin imports: `app/robots.ts` lo usa también en un clon sin sitio público.
 */

/**
 * Lo que puede leer CUALQUIER robot: el link público de un diseño (`/d/<código>`). Cada página lleva su
 * `noindex`, salvo una página web publicada con "Permitir que aparezca en buscadores" (Diseñador IA): sin
 * esto, esa opción no haría nada porque el robot ni la leería. Los códigos son al azar y no se pueden listar.
 */
export const ALWAYS_CRAWLABLE = ["/d/"]; // @plantilla-quitar(disenador)
// @plantilla-sin(disenador): export const ALWAYS_CRAWLABLE: string[] = [];

export const PREVIEW_BOTS = [
  "facebookexternalhit",
  "Facebot",
  "WhatsApp",
  "Twitterbot",
  "LinkedInBot",
  "TelegramBot",
  "Slackbot",
  "Discordbot",
];

/**
 * Un robot con grupo propio ignora el de `*`: las páginas del sitio del clon se le repiten
 * acá. `/l/` es el link con seguimiento: el lector lo sigue hasta la página de destino.
 * `/d/` es el link público de un diseño (Diseñador IA): la tarjeta lleva su imagen.
 */
export function previewBotRule(sitePaths: string[] = []) {
  return {
    userAgent: PREVIEW_BOTS,
    allow: ["/calendario/", "/f/", "/l/", "/d/", ...sitePaths], // @plantilla-quitar(disenador)
    // @plantilla-sin(disenador): allow: ["/calendario/", "/f/", "/l/", ...sitePaths],
    disallow: ["/calendario/agenda/", "/"],
  };
}
