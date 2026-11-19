"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent } from "react";
import { ROW_INTERACTIVE_SELECTOR, rowClickIntent } from "@/lib/ui/row-click";

/**
 * Hace que TODA una fila de tabla (o una tarjeta) abra su registro, no solo la primera columna. Devuelve las props para
 * ponerle al `<tr>` (o al contenedor): `<tr {...useRowOpen({ href })}>`.
 *
 * - `href`: la dirección del registro. Un clic navega (sin mover el scroll, así un drawer o un modal por URL abre en el
 *   lugar); Cmd/Ctrl/Shift + clic o el botón del medio la abren en otra pestaña, como un link común.
 * - `onOpen`: para lo que no es una dirección (abrir un diálogo, elegir una variante, filtrar un dashboard).
 * - Sin ninguno de los dos (o con `disabled`), la fila no hace nada y no se ve clickeable.
 *
 * Los controles de la fila (links a otra cosa, botones, casillas, desplegables) hacen lo suyo y no abren la fila
 * (`ROW_INTERACTIVE_SELECTOR`). Un `PortalMenu` frena sus clics solo. Seleccionar texto tampoco abre nada.
 * Con el teclado: Tab llega a la fila y Enter (o Espacio) la abre; las teclas de un control de adentro no.
 */
export function useRowOpen({
  href,
  onOpen,
  beforeNavigate,
  disabled = false,
}: {
  href?: string | null;
  onOpen?: () => void;
  /** Antes de navegar a `href` en la misma pestaña (por ejemplo, recordar la fila para devolverle el foco al cerrar un modal). */
  beforeNavigate?: (row: HTMLElement) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const active = !disabled && (!!href || !!onOpen);
  if (!active) return {};

  const open = (row: HTMLElement) => {
    if (onOpen) onOpen();
    else if (href) {
      beforeNavigate?.(row);
      router.push(href, { scroll: false });
    }
  };

  const handle = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    // Un clic que viene de un portal (un diálogo o menú dibujado afuera de la fila) burbujea por el árbol de React
    // pero no está adentro de la fila en la página: no la abre.
    if (!target || !event.currentTarget.contains(target)) return;
    const hit = target.closest(ROW_INTERACTIVE_SELECTOR);
    const interactive = !!hit && hit !== event.currentTarget && event.currentTarget.contains(hit);
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    const intent = rowClickIntent({
      button: event.button,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      targetIsInteractive: interactive,
      hasTextSelection: !!selection && !selection.isCollapsed && selection.toString().trim().length > 0,
      hasHref: !!href,
    });
    if (intent === "ignore") return;
    if (intent === "new-tab" && href) {
      event.preventDefault();
      window.open(href, "_blank", "noopener");
      return;
    }
    open(event.currentTarget);
  };

  return {
    tabIndex: 0,
    "data-clickable-row": "",
    onClick: handle,
    onAuxClick: (event: MouseEvent<HTMLElement>) => {
      if (event.button === 1) handle(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event.currentTarget);
      }
    },
  };
}

/** Las clases de una fila que abre algo (sumar a las que ya tenga). */
export const CLICKABLE_ROW_CLASS = "cursor-pointer focus:outline-none focus-visible:bg-muted/60";
