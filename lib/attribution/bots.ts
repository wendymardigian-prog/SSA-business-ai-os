/**
 * ¿Quien abrio el link es un previsualizador y no una persona? (Extra I, F40.)
 *
 * Cuando alguien manda un link por Instagram, WhatsApp, Slack o Telegram, la plataforma lo abre sola para armar la
 * tarjeta de vista previa. Si esa visita contara como un clic, cada link enviado "se clickearia" solo y el toque
 * `link_click` diria que la persona lo abrio sin haberlo hecho. Estos User-Agent redirigen igual (la tarjeta tiene
 * que mostrar el destino) pero NO registran nada.
 *
 * Decisiones:
 *   - La lista es la del plano (facebookexternalhit, Facebot, WhatsApp, Instagram, TelegramBot, Slackbot,
 *     Twitterbot, LinkedInBot, Discordbot, Googlebot) mas unos pocos rastreadores equivalentes que se ven en la
 *     practica (Meta, Bing, Apple, Pinterest, Reddit, Skype, Embedly).
 *   - **Un User-Agent vacio es un bot**: ningun navegador real lo manda vacio.
 *   - **"Instagram" es el caso delicado**: el navegador interno de Instagram (donde una persona SI hizo clic) manda
 *     un User-Agent de navegador real que termina con "Instagram 3xx.x" (iOS: `Mozilla/5.0 (iPhone; …) Mobile/15E148
 *     Instagram 300.0…`; Android: `Mozilla/5.0 (Linux; Android …) … Mobile Safari/537.36 Instagram 300.0…`). En
 *     cambio el que arma la vista previa manda el User-Agent PELADO de la app (`Instagram 300.0.0.0 Android (…)`),
 *     sin la parte "Mozilla/5.0". Regla: contiene "instagram" y NO contiene "mozilla/" → previsualizador. Un navegador
 *     interno cuenta como persona.
 *   - Por la misma razon "FBAN/FBIOS" y "FB_IAB" (el navegador interno de Facebook) NO estan en la lista.
 *
 * Modulo PURO. Nunca lanza.
 */

/** Fragmentos (en minusculas) que identifican a un previsualizador o rastreador. */
export const LINK_PREVIEW_BOT_TOKENS: readonly string[] = [
  "facebookexternalhit",
  "facebot",
  "whatsapp",
  "telegrambot",
  "slackbot",
  "slack-imgproxy",
  "twitterbot",
  "linkedinbot",
  "discordbot",
  "googlebot",
  // Equivalentes que no estan en el plano pero hacen lo mismo.
  "meta-externalagent",
  "meta-externalfetcher",
  "bingbot",
  "applebot",
  "pinterestbot",
  "redditbot",
  "skypeuripreview",
  "embedly",
];

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string") return true;
  const ua = userAgent.trim().toLowerCase();
  if (ua === "") return true;

  if (LINK_PREVIEW_BOT_TOKENS.some((token) => ua.includes(token))) return true;

  // La app de Instagram sin navegador (la vista previa); el navegador interno trae "Mozilla/".
  if (ua.includes("instagram") && !ua.includes("mozilla/")) return true;

  return false;
}
