/**
 * Qué pueden leer los lectores de vista previa de `robots.txt`.
 *
 * La regla general sigue bloqueando todo. Sin esta excepción, LinkedIn y X no arman la
 * tarjeta de un link de agenda o de un formulario, porque respetan el bloqueo. Las páginas
 * siguen con su `noindex`, y `/calendario/agenda/` queda cerrado: ahí la URL es una credencial.
 *
 * Módulo sin imports: `app/robots.ts` lo usa también en un clon sin sitio público.
 */

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
 */
export function previewBotRule(sitePaths: string[] = []) {
  return {
    userAgent: PREVIEW_BOTS,
    allow: ["/calendario/", "/f/", "/l/", ...sitePaths],
    disallow: ["/calendario/agenda/", "/"],
  };
}
