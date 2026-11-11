"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un menu desplegable que se dibuja fuera de donde esta el boton.
 *
 * Por que no `FilterMenu` ni un menu `absolute`: adentro de una tabla con
 * `overflow-x-auto` (la lista de Agenda) o de un panel con scroll, un panel
 * absoluto queda recortado. Este va al `<body>` con `position: fixed`, pegado
 * al boton, y se acomoda para entrar entero en la pantalla (abajo; si no
 * entra y arriba si, arriba).
 *
 * Para usarlo adentro de una fila o tarjeta que se abre al hacer clic: el
 * boton y el panel frenan el clic y las teclas, asi abrir el menu o elegir una
 * opcion NO abre la fila. (Un portal de React burbuja los eventos por el arbol
 * de React, no por el del navegador: sin frenarlos, la fila se enteraria.)
 *
 * Cierra con Esc (devolviendo el foco al boton), al hacer clic afuera, al
 * desplazar la pagina y al cambiar el tamaño de la ventana. Con el teclado:
 * flechas, Home y End recorren las opciones.
 */

const CloseContext = createContext<(() => void) | null>(null);

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const MARGIN = 8;
const GAP = 4;

interface Placement {
  left: number;
  width: number;
  /** Se anclan arriba (`top`) o abajo (`bottom`): el panel crece para el lado donde hay lugar. */
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function place(rect: DOMRect, width: number, align: "start" | "end", maxHeight: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - MARGIN * 2);
  const wanted = align === "end" ? rect.right - w : rect.left;
  const left = Math.max(MARGIN, Math.min(wanted, vw - MARGIN - w));
  const below = vh - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  // Abajo si entra lo que se pide; si no, donde haya mas lugar.
  if (below >= Math.min(maxHeight, 220) || below >= above) return { left, width: w, top: rect.bottom + GAP, maxHeight: Math.max(120, Math.min(maxHeight, below)) };
  return { left, width: w, bottom: vh - rect.top + GAP, maxHeight: Math.max(120, Math.min(maxHeight, above)) };
}

export function PortalMenu({
  label,
  trigger,
  children,
  disabled = false,
  title,
  align = "start",
  width = 260,
  maxHeight = 360,
  triggerClassName,
}: {
  /** El nombre accesible del boton ("Cambiar el estado"). */
  label: string;
  /** Lo que se dibuja adentro del boton. */
  trigger: ReactNode;
  /** Las opciones: `PortalMenuItem`, `PortalMenuLabel`, `PortalMenuSeparator`. */
  children: ReactNode;
  disabled?: boolean;
  /** El tooltip nativo del boton (por ejemplo, por que esta deshabilitado). */
  title?: string;
  align?: "start" | "end";
  width?: number;
  maxHeight?: number;
  triggerClassName?: string;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const open = placement !== null;

  const close = useCallback((returnFocus = false) => {
    setPlacement(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPlacement(place(rect, width, align, maxHeight));
  }, [open, close, width, align, maxHeight]);

  // Al abrir, el foco va a la opcion elegida (o a la primera).
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector<HTMLElement>('[role="menuitem"][aria-current="true"]:not([disabled])') ?? panel.querySelector<HTMLElement>(ITEM_SELECTOR);
    // Sin desplazar: un scroll al abrir cerraria el menu (el de la pagina lo cierra).
    target?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    // El scroll del propio menu (una lista larga) no lo cierra; el de la pagina, si: el menu quedaria flotando lejos de su boton.
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        onKeyDown={(event) => {
          // Enter o espacio abren el menu; que la fila de atras no se entere. Esc si pasa: cierra el detalle de atras.
          if (event.key !== "Escape") event.stopPropagation();
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn("inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default", triggerClassName)}
      >
        {trigger}
      </button>
      {open &&
        placement &&
        createPortal(
          <CloseContext.Provider value={() => close(true)}>
            <div
              ref={panelRef}
              id={id}
              role="menu"
              aria-label={label}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={onPanelKeyDown}
              style={{ left: placement.left, width: placement.width, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight }}
              className="fixed z-[70] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
            >
              {children}
            </div>
          </CloseContext.Provider>,
          document.body,
        )}
    </>
  );
}

/** Una opcion. `selected` marca la actual (con un tilde); `disabled` la apaga, con `title` para decir por que. */
export function PortalMenuItem({
  children,
  onSelect,
  selected = false,
  disabled = false,
  title,
  className,
}: {
  children: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const close = useContext(CloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={selected ? "true" : undefined}
      disabled={disabled}
      title={title}
      onClick={() => {
        close?.();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        selected && "font-medium",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

export function PortalMenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function PortalMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}
