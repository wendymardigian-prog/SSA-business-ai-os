"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Un popover: un boton que abre un panel flotante.
 *
 * Lo que da y que hay que reponer a mano: cierra con Esc devolviendo el foco
 * al boton, cierra al hacer clic afuera, y el boton anuncia (`aria-expanded`,
 * `aria-controls`) que abre un panel. El panel es `role="dialog"` y no un
 * menu: adentro hay texto y botones sueltos, no una lista de opciones.
 */
export function Popover({
  label,
  trigger,
  children,
  align = "end",
  panelClassName = "w-72",
  triggerClassName = "",
}: {
  /** El nombre accesible del boton. */
  label: string;
  /** Lo que se dibuja adentro del boton (un icono). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  panelClassName?: string;
  triggerClassName?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={`absolute top-full z-50 mt-1 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg ${
            align === "end" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
