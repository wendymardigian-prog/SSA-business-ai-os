// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * El lado de adentro del embed (F41): lo que corre en el booker cuando la
 * página va dentro de un iframe. Adaptado de
 * `packages/embeds/embed-core/src/embed-iframe.ts`, reducido a lo que el
 * plano pide: avisar que cargó, avisar la altura y emitir los cinco eventos.
 *
 * Dos reglas que no se negocian:
 *  - Los mensajes que SALEN no llevan nunca datos del formulario: solo el
 *    código público de la agenda, el rango y el slug del evento.
 *  - Los mensajes que ENTRAN (`ssa:ui`) se aceptan solo si vienen del origen
 *    que el script del cliente declaró. Cualquier página puede mandar un
 *    postMessage a un iframe; el origen es lo único que los distingue.
 */

import { EMBED_MESSAGE_SOURCE, embedMessage, isTrustedOrigin, parseEmbedMessage, type EmbedMessageType } from "./events";

export interface IframeWindow {
  parent: { postMessage: (message: unknown, targetOrigin: string) => void };
  addEventListener: (type: string, listener: (event: { data: unknown; origin: string }) => void) => void;
  removeEventListener: (type: string, listener: (event: { data: unknown; origin: string }) => void) => void;
  self: unknown;
  top: unknown;
  location: { search: string };
}

export interface IframeSideOptions {
  window: IframeWindow;
  /** El origen de la página que embebió, tal como llegó en `?embedOrigin=`. */
  parentOrigin: string | null;
  namespace?: string;
  /** Qué hacer cuando el padre pide cambiar el tema o el color. */
  onUi?: (ui: { theme?: string; brandColor?: string }) => void;
}

export interface IframeSide {
  /** Avisa que el booker está listo para que el padre muestre el iframe. */
  ready(): void;
  /** Manda la altura del contenido, para que el iframe crezca con él. */
  sendHeight(height: number): void;
  /** Emite un evento público. */
  emit(type: EmbedMessageType, payload: unknown): void;
  stop(): void;
}

/** Verdadero si la página está adentro de un iframe. */
export function isInsideIframe(win: Pick<IframeWindow, "self" | "top">): boolean {
  return win.self !== win.top;
}

/**
 * El origen de la página que embebió, sacado de la URL del iframe.
 *
 * El script del cliente ya manda `?referrer=<su URL completa>`; de ahí sale
 * el origen. `embedOrigin` se acepta además por si alguien arma la URL a
 * mano. Se queda solo con el origen: la ruta no hace falta y no conviene
 * guardarla.
 */
export function parentOriginFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of ["embedOrigin", "referrer"]) {
    const value = params.get(key);
    if (!value) continue;
    try {
      const { origin } = new URL(value);
      if (origin && origin !== "null") return origin;
    } catch {
      // Sigue con la siguiente.
    }
  }
  return null;
}

export function connectIframeSide(options: IframeSideOptions): IframeSide {
  const { window: win, namespace = "" } = options;
  // Sin origen declarado no se le habla a nadie: `*` dejaría los mensajes al
  // alcance de cualquier página que embeba esta en otro iframe.
  const target = options.parentOrigin;
  let lastHeight = -1;

  const post = (type: EmbedMessageType, payload: unknown) => {
    if (!target) return;
    win.parent.postMessage(embedMessage(type, payload, namespace), target);
  };

  const onMessage = (event: { data: unknown; origin: string }) => {
    if (!target || !isTrustedOrigin(event.origin, target)) return;
    const message = parseEmbedMessage(event.data);
    if (!message || message.type !== "ssa:ui") return;
    options.onUi?.((message.payload ?? {}) as { theme?: string; brandColor?: string });
  };

  win.addEventListener("message", onMessage);

  return {
    ready: () => post("ssa:loaded", { source: EMBED_MESSAGE_SOURCE }),
    sendHeight: (height: number) => {
      const rounded = Math.ceil(height);
      // Solo cuando cambia: el observador dispara muchas veces por el mismo
      // número y cada mensaje obliga al padre a recalcular el layout.
      if (rounded === lastHeight || rounded <= 0) return;
      lastHeight = rounded;
      post("ssa:height", { height: rounded });
    },
    emit: (type, payload) => post(type, payload),
    stop: () => win.removeEventListener("message", onMessage),
  };
}
