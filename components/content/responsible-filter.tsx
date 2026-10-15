"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { NO_RESPONSIBLE as noneValue, toggleResponsible as toggle } from "@/lib/content/filters";

/**
 * El filtro de Responsable de la lista de Contenido (Extra I, F43): varias personas a la vez, con casillas.
 *
 * Un `<select>` nativo elige una sola; aca se pueden sumar varias y «Sin responsable». El boton abre un panel (con
 * `aria-expanded`), Esc lo cierra devolviendo el foco, y un clic afuera tambien. Cada casilla cambia la URL en el
 * momento (el estado vive en la URL, como el resto de los filtros).
 */
export function ResponsibleFilter({
  selected,
  team,
  onChange,
}: {
  selected: string[];
  team: Array<{ id: string; name: string }>;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const nameOf = (value: string) => (value === noneValue ? "Sin responsable" : (team.find((m) => m.id === value)?.name ?? "Alguien"));
  const summary =
    selected.length === 0 ? "todos" : selected.length === 1 ? nameOf(selected[0]) : `${selected.length} elegidos`;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border bg-background px-2 text-sm",
          selected.length > 0 ? "border-primary bg-primary/10" : "border-border",
        )}
      >
        <span className="shrink-0 text-muted-foreground">Responsable:</span>
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          role="group"
          aria-label="Responsable"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          {[{ id: noneValue, name: "Sin responsable" }, ...team].map((member) => (
            <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={selected.includes(member.id)}
                onChange={() => onChange(toggle(selected, member.id))}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1 truncate">{member.name}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              Quitar el filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
