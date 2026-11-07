"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Hasta aca del final todavia cuenta como "estar abajo". */
const NEAR_BOTTOM_PX = 80;
/** Lo que dura el scroll suave: sus eventos no dicen que la persona se haya movido. */
const SMOOTH_SCROLL_MS = 800;

/**
 * Mantiene el hilo abajo cuando algo cambia de tamaño despues de pintarse: una tarjeta de link que llega tarde o el
 * composer que crece. Si la persona subio a leer, no la mueve.
 *
 * Observa la lista (crece lo de adentro) y el contenedor (el composer le saca lugar). `markAtBottom` lo llama quien hace
 * el scroll suave al llegar un mensaje.
 */
export function useStickToBottom(containerRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>): () => void {
  const atBottom = useRef(true);
  const ignoreScrollUntil = useRef(0);

  const markAtBottom = useCallback(() => {
    atBottom.current = true;
    ignoreScrollUntil.current = Date.now() + SMOOTH_SCROLL_MS;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;

    const onScroll = () => {
      if (Date.now() < ignoreScrollUntil.current) return;
      atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
    };
    // La persona se movio: lo que siga contando es su scroll, aunque haya uno suave en curso.
    const onUserScroll = () => {
      ignoreScrollUntil.current = 0;
    };
    const observer = new ResizeObserver(() => {
      if (atBottom.current) container.scrollTop = container.scrollHeight;
    });

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onUserScroll, { passive: true });
    container.addEventListener("touchmove", onUserScroll, { passive: true });
    observer.observe(container);
    observer.observe(list);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onUserScroll);
      container.removeEventListener("touchmove", onUserScroll);
      observer.disconnect();
    };
  }, [containerRef, listRef]);

  return markAtBottom;
}
