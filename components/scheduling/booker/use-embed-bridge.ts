"use client";

/**
 * El puente entre el booker y la página que lo embebió (F41).
 *
 * Solo hace algo dentro de un iframe. Manda la altura con un
 * `ResizeObserver`, porque el booker cambia de alto al elegir un día o al
 * pasar al formulario, y un iframe de alto fijo deja el formulario cortado.
 */

import { useEffect, useRef } from "react";
import { connectIframeSide, isInsideIframe, parentOriginFromSearch, type IframeSide, type IframeWindow } from "@/lib/embed/iframe-side";
import type { EmbedMessageType } from "@/lib/embed/events";

export interface EmbedBridge {
  emit: (type: EmbedMessageType, payload: unknown) => void;
}

export function useEmbedBridge(enabled: boolean, onUi?: (ui: { theme?: string; brandColor?: string }) => void): EmbedBridge {
  const side = useRef<IframeSide | null>(null);
  const uiRef = useRef(onUi);
  // En un efecto y no durante el render: tocar un ref mientras se renderiza es
  // un error para React 19 (y rompe `npm run lint`). El efecto corre despues de
  // cada render, asi que la referencia sigue siendo la ultima que llego.
  useEffect(() => {
    uiRef.current = onUi;
  }, [onUi]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!isInsideIframe({ self: window.self, top: window.top })) return;

    const connection = connectIframeSide({
      window: window as unknown as IframeWindow,
      parentOrigin: parentOriginFromSearch(window.location.search),
      onUi: (ui) => uiRef.current?.(ui),
    });
    side.current = connection;
    connection.ready();
    connection.emit("agenda:bookerReady", {});

    const observer = new ResizeObserver(() => connection.sendHeight(document.documentElement.scrollHeight));
    observer.observe(document.documentElement);
    connection.sendHeight(document.documentElement.scrollHeight);

    return () => {
      observer.disconnect();
      connection.stop();
      side.current = null;
    };
  }, [enabled]);

  return {
    emit: (type, payload) => side.current?.emit(type, payload),
  };
}
