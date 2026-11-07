"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/** Una opcion del menu de una fila: cambia lo que muestra la pantalla o lleva a otra. */
export interface RowAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  /** Lo que ya está elegido (el orden actual de una columna): lleva un tilde. */
  checked?: boolean;
}

const MENU_WIDTH = 240;
const EDGE_GAP = 12;
/** Alto de cada opcion y del nombre de arriba, para abrir hacia arriba si abajo no entra. */
const ITEM_HEIGHT = 36;

/**
 * El menu que abre una fila de la tabla en la pantalla Anuncios, o el encabezado de una columna (ordenar, fijar). Va `fixed` y a mano, donde se hizo clic: la tabla se
 * desplaza de costado y un panel `absolute` quedaria cortado. Se cierra con Esc, al hacer clic afuera y al desplazar.
 */
export function RowActionsMenu({ label, actions, x, y, onClose }: { label: string; actions: RowAction[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = typeof window === "undefined" ? x : Math.max(EDGE_GAP, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_GAP));
  const height = ITEM_HEIGHT * (actions.length + 1);
  const top = typeof window === "undefined" || y + 4 + height + EDGE_GAP <= window.innerHeight ? y + 4 : Math.max(EDGE_GAP, y - height - 4);
  const itemClass = "w-full rounded-md px-2.5 py-1.5 text-left text-sm text-popover-foreground hover:bg-accent focus:bg-accent focus:outline-none";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left, top, width: MENU_WIDTH }}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 space-y-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      <p className="truncate px-2.5 py-1 text-[11px] text-muted-foreground" title={label}>
        {label}
      </p>
      {actions.map((action) =>
        action.href ? (
          <Link key={action.label} role="menuitem" href={action.href} onClick={onClose} className={`block ${itemClass}`}>
            {action.label}
          </Link>
        ) : (
          <button
            key={action.label}
            type="button"
            role={action.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={action.checked}
            onClick={() => {
              onClose();
              action.onSelect?.();
            }}
            className={`flex items-center justify-between gap-2 ${itemClass}`}
          >
            {action.label}
            {action.checked && <span className="text-primary-ink" aria-hidden>✓</span>}
          </button>
        ),
      )}
    </div>
  );
}
