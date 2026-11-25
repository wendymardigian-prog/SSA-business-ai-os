"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

/** Cuánto se mueve el dedo (px) antes de que deje de contar como «mantener apretado». */
const MOVE_TOLERANCE = 10;

/**
 * Mantener apretado con el dedo `ms` milisegundos llama a `onLongPress`. Solo
 * táctil: con mouse o teclado siguen los botones de siempre. El clic que llega
 * al soltar después de un long-press se descarta, para no abrir lo que se
 * estaba tocando.
 */
export function useLongPress(onLongPress: (() => void) | null, ms = 2000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      fired.current = false;
      if (!onLongPress || e.pointerType !== "touch") return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(15);
          } catch {
            /* sin vibración: no pasa nada */
          }
        }
        onLongPress();
      }, ms);
    },
    [onLongPress, ms],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!start.current) return;
      if (Math.abs(e.clientX - start.current.x) > MOVE_TOLERANCE || Math.abs(e.clientY - start.current.y) > MOVE_TOLERANCE) cancel();
    },
    [cancel],
  );

  /** Para el `onClick` del botón: `true` si ese clic viene de soltar un long-press. */
  const swallowClick = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return false;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // Sin el menú del sistema (copiar, compartir) al mantener apretado.
      onContextMenu: (e: ReactMouseEvent) => {
        if (onLongPress) e.preventDefault();
      },
    },
    swallowClick,
  };
}
