"use client";

import { useRouter } from "next/navigation";
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ROW_INTERACTIVE_SELECTOR, rowClickIntent } from "@/lib/ui/row-click";

/**
 * Hace que TODA una fila de tabla (o una tarjeta) abra su registro, no solo la primera columna (docs/tablas.md).
 *
 * - `href`: la dirección del registro. Un clic navega (sin mover el scroll, así un drawer o un modal por URL abre en el
 *   lugar); Cmd/Ctrl/Shift + clic o el botón del medio la abren en otra pestaña, como un link común.
 * - `onOpen`: para lo que no es una dirección (abrir un diálogo, elegir una variante, filtrar un dashboard). Gana sobre
 *   `href` en un clic común; `href` sigue sirviendo para abrir otra pestaña.
 * - Sin ninguno de los dos (o con `disabled`), la fila no hace nada y no se ve clickeable.
 *
 * Los controles de la fila (links a otra cosa, botones, casillas, desplegables) hacen lo suyo y no abren la fila
 * (`ROW_INTERACTIVE_SELECTOR`). Un `PortalMenu` frena sus clics solo. Seleccionar texto tampoco abre nada.
 * Con el teclado: Tab llega a la fila y Enter (o Espacio) la abre; las teclas de un control de adentro no.
 *
 * Solo lo que navega a una dirección usa el router de Next (`useRowOpen`); una fila con `onOpen` y sin `href` se dibuja
 * sin router, así también anda fuera de una página (los tests que la dibujan sueltas).
 */

export interface RowOpenOptions {
  href?: string | null;
  onOpen?: () => void;
  /** Antes de navegar a `href` en la misma pestaña (por ejemplo, recordar la fila para devolverle el foco al cerrar un modal). */
  beforeNavigate?: (row: HTMLElement) => void;
  disabled?: boolean;
}

/** Las clases de una fila que abre algo (sumar a las que ya tenga). */
export const CLICKABLE_ROW_CLASS = "cursor-pointer focus:outline-none focus-visible:bg-muted/60";

/** Las props de la fila, sin hooks: `navigate` es cómo ir a `href` en la misma pestaña. */
function rowOpenProps({ href, onOpen, beforeNavigate, disabled = false }: RowOpenOptions, navigate?: (href: string) => void) {
  const active = !disabled && (!!onOpen || (!!href && !!navigate));
  if (!active) return {};

  const open = (row: HTMLElement) => {
    if (onOpen) onOpen();
    else if (href && navigate) {
      beforeNavigate?.(row);
      navigate(href);
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

/** Las props para un `<tr>` (o contenedor) que navega con el router de Next: `<tr {...useRowOpen({ href })}>`. */
export function useRowOpen(options: RowOpenOptions) {
  const router = useRouter();
  return rowOpenProps(options, (href) => router.push(href, { scroll: false }));
}

function isClickable({ href, onOpen, disabled }: RowOpenOptions) {
  return !disabled && (!!href || !!onOpen);
}

type TrProps = RowOpenOptions & HTMLAttributes<HTMLTableRowElement> & { children: ReactNode };
type BoxProps = RowOpenOptions & HTMLAttributes<HTMLDivElement> & { children: ReactNode };

function TrWithRouter({ href, onOpen, beforeNavigate, disabled, className, children, ...rest }: TrProps) {
  const props = useRowOpen({ href, onOpen, beforeNavigate, disabled });
  return (
    <tr {...rest} {...props} className={cn(className, isClickable({ href, onOpen, disabled }) && CLICKABLE_ROW_CLASS)}>
      {children}
    </tr>
  );
}

function BoxWithRouter({ href, onOpen, beforeNavigate, disabled, className, children, ...rest }: BoxProps) {
  const props = useRowOpen({ href, onOpen, beforeNavigate, disabled });
  return (
    <div {...rest} {...props} className={cn(className, isClickable({ href, onOpen, disabled }) && CLICKABLE_ROW_CLASS)}>
      {children}
    </div>
  );
}

/**
 * Un `<tr>` que abre su registro con un clic en cualquier parte (para las tablas que arman sus filas en un `map`, donde
 * no se puede llamar a un hook por fila). Mismas reglas que `useRowOpen`.
 */
export function ClickableTr(props: TrProps) {
  if (props.href) return <TrWithRouter {...props} />;
  const { href: _href, onOpen, beforeNavigate: _before, disabled, className, children, ...rest } = props;
  void _href;
  void _before;
  return (
    <tr {...rest} {...rowOpenProps({ onOpen, disabled })} className={cn(className, isClickable({ onOpen, disabled }) && CLICKABLE_ROW_CLASS)}>
      {children}
    </tr>
  );
}

/** Lo mismo para una fila o tarjeta que no es de tabla (`<div>`). */
export function ClickableBox(props: BoxProps) {
  if (props.href) return <BoxWithRouter {...props} />;
  const { href: _href, onOpen, beforeNavigate: _before, disabled, className, children, ...rest } = props;
  void _href;
  void _before;
  return (
    <div {...rest} {...rowOpenProps({ onOpen, disabled })} className={cn(className, isClickable({ onOpen, disabled }) && CLICKABLE_ROW_CLASS)}>
      {children}
    </div>
  );
}
