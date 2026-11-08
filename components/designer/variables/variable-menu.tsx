"use client";

import { useEffect, useRef } from "react";
import { variableGroups, type CustomVar } from "@/lib/designer/variables/catalog";
import { cn } from "@/lib/utils";

/**
 * El menú de variables agrupado (F24): Propias · Contacto · Negocio · Diseño · las que registren otros módulos.
 *
 * - `insert`: «{ } Insertar variable». Elegir una la pone en el cursor del texto (dentro de un chip, después de él).
 * - `swap`: se tocó un chip: «Cambiar por…» y «Quitar la variable».
 *
 * `design.code` y `design.doc_type` solo se ofrecen en plantillas con verificación (`variableGroups`). El menú no le saca
 * el foco al texto que se está escribiendo.
 */
export function VariableMenu({
  mode,
  currentKey,
  customVars,
  verify,
  anchor,
  onPick,
  onRemove,
  onCreateOwn,
  onClose,
}: {
  mode: "insert" | "swap";
  currentKey?: string;
  customVars: readonly CustomVar[];
  verify: boolean;
  /** El rectángulo del botón o del chip que lo abrió. */
  anchor: { left: number; top: number; bottom: number };
  onPick: (key: string) => void;
  onRemove?: () => void;
  /** «Crear una variable propia…»: lleva a la pestaña Variables. */
  onCreateOwn: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const groups = variableGroups({ customVars, verify });

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const left = typeof window === "undefined" ? anchor.left : Math.max(8, Math.min(anchor.left, window.innerWidth - 320));
  const top = typeof window === "undefined" ? anchor.bottom + 6 : Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 380));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={mode === "swap" ? "Cambiar la variable" : "Insertar variable"}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[60] flex max-h-[min(60vh,420px)] w-[300px] flex-col overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg max-sm:inset-x-3 max-sm:bottom-3 max-sm:top-auto max-sm:w-auto max-sm:max-h-[60dvh]"
      style={{ left, top }}
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{mode === "swap" ? "Cambiar por" : "Insertar variable"}</p>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="px-2.5 pb-0.5 pt-2 text-[11px] text-muted-foreground">{group.label}</p>
          {group.vars.map((v) => (
            <button
              key={v.key}
              type="button"
              role="menuitem"
              aria-current={v.key === currentKey ? "true" : undefined}
              onClick={() => onPick(v.key)}
              className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent", v.key === currentKey && "bg-primary/10")}
            >
              <span>{v.label}</span>
              <span className="truncate text-[11px] text-muted-foreground">{v.sample}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="my-1 h-px bg-border" />
      {mode === "swap" ? (
        <button type="button" role="menuitem" onClick={onRemove} className="rounded-lg px-2.5 py-1.5 text-left text-[13px] text-bad hover:bg-accent">
          Quitar la variable
        </button>
      ) : (
        <button type="button" role="menuitem" onClick={onCreateOwn} className="rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent">
          Crear una variable propia…
        </button>
      )}
    </div>
  );
}
