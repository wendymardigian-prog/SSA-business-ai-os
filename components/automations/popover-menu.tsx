"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Un menu desplegable chico y accesible: el boton lo abre, Escape o un clic
 * afuera lo cierra, las flechas mueven entre opciones y Enter elige. Lo usan
 * "+ Agregar paso" y el menu de cada paso.
 */

export type MenuItem =
  | { key: string; label: ReactNode; onSelect: () => void; disabled?: boolean; hint?: string; destructive?: boolean }
  | { key: string; separator: true };

export function PopoverMenu({
  trigger,
  triggerLabel,
  items,
  align = "left",
  triggerClassName,
  disabled = false,
}: {
  /** Lo que se ve en el boton. */
  trigger: ReactNode;
  /** El nombre accesible del boton si lo que se ve no alcanza (un icono). */
  triggerLabel?: string;
  items: MenuItem[];
  align?: "left" | "right";
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Al abrir, el foco va a la primera opcion que se puede elegir.
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function moveFocus(event: React.KeyboardEvent, direction: 1 | -1) {
    event.preventDefault();
    const all = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + direction + all.length) % all.length]?.focus();
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") moveFocus(e, 1);
            if (e.key === "ArrowUp") moveFocus(e, -1);
          }}
          className={cn("absolute z-30 mt-1 min-w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1 shadow-lg", align === "right" ? "right-0" : "left-0")}
        >
          {items.map((item) =>
            "separator" in item ? (
              <div key={item.key} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full flex-col rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                  item.destructive && "text-red-600 dark:text-red-400",
                )}
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-[11px] font-normal text-muted-foreground">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
