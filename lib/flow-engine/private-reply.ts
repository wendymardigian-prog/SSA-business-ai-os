/**
 * Las reglas de «Responder por privado»: lo que el panel deja escribir y lo que el nodo le manda a Zernio. Puro: lo usan
 * los dos, para que la pantalla no ofrezca algo que despues no sale.
 *
 * Un boton mal armado no se manda: Zernio lo rechazaria, y un rechazo puede gastar la unica respuesta privada que
 * Instagram permite por comentario.
 */

/** Meta: el texto de un mensaje con botones llega hasta 640 caracteres. */
export const PRIVATE_REPLY_TEXT_MAX = 640;
export const PRIVATE_REPLY_MAX_BUTTONS = 3;
export const PRIVATE_REPLY_BUTTON_TITLE_MAX = 20;

export interface PrivateReplyButton {
  type: "url";
  title: string;
  url: string;
}

/** Solo links http(s). Un `{{variable}}` sin resolver o una direccion rota no pasan. */
export function isButtonUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Los botones que se pueden mandar: con titulo, con link valido y hasta tres. */
export function sendablePrivateReplyButtons(raw: unknown): PrivateReplyButton[] {
  if (!Array.isArray(raw)) return [];
  const buttons: PrivateReplyButton[] = [];
  for (const item of raw) {
    const { title, url } = (item ?? {}) as { title?: unknown; url?: unknown };
    if (typeof title !== "string" || typeof url !== "string") continue;
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > PRIVATE_REPLY_BUTTON_TITLE_MAX || !isButtonUrl(url)) continue;
    buttons.push({ type: "url", title: cleanTitle, url: url.trim() });
    if (buttons.length === PRIVATE_REPLY_MAX_BUTTONS) break;
  }
  return buttons;
}
