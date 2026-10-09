"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un buscador que ocupa un icono (32 px) hasta que se lo necesita.
 *
 * Cerrado es una lupa. Al hacerle clic se expande a un campo con el foco
 * puesto; Enter busca, Esc descarta lo escrito (o cierra si no hay nada
 * buscado) y la X limpia la busqueda. Si hay una busqueda aplicada arranca
 * abierto: no se puede esconder lo que esta filtrando la lista.
 *
 * `hint` es un cartel que explica el alcance de la busqueda (por ejemplo, que
 * solo mira dentro del periodo elegido). Aparece al apoyar el mouse o tener el
 * foco, y esta atado al campo con `aria-describedby`.
 *
 * Es controlado desde afuera: `value` es lo APLICADO (lo que esta en la URL) y
 * `onCommit` avisa cuando cambia. El texto a medio escribir vive aca.
 */
export function ExpandableSearch({
  value,
  onCommit,
  label,
  placeholder,
  hint,
  hintAlign = "left",
  pending = false,
  inputClassName,
}: {
  /** La busqueda aplicada. */
  value: string;
  onCommit: (next: string) => void;
  /** Nombre accesible del boton y del campo ("Buscar contacto"). */
  label: string;
  placeholder?: string;
  hint?: string | null;
  /** De que lado del campo se alinea el cartel: "right" cuando el buscador esta al borde derecho de la barra y se saldria de la pantalla. */
  hintAlign?: "left" | "right";
  pending?: boolean;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(value !== "");
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Si lo aplicado cambia desde afuera (un "limpiar filtros", el boton atras),
  // el campo lo sigue: se ajusta en el render, no en un efecto.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
    setOpen(value !== "");
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit(next: string) {
    const clean = next.trim();
    if (clean !== value) onCommit(clean);
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <div role="search" className="group relative shrink-0">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Escape") {
            e.preventDefault();
            // Primero descarta lo escrito; si no habia nada pendiente, cierra.
            if (draft !== value) setDraft(value);
            else if (value === "") setOpen(false);
          }
        }}
        onBlur={() => {
          if (draft.trim() !== value) commit(draft);
          else if (draft.trim() === "") setOpen(false);
        }}
        placeholder={placeholder ?? label}
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        // Respaldo nativo: en la franja del telefono el cartel queda cortado por el scroll.
        title={hint ?? undefined}
        className={cn(
          "h-8 w-44 rounded-lg border border-input bg-background pl-8 pr-8 text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring sm:w-56",
          value !== "" && "border-primary",
          inputClassName,
        )}
      />
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <button
            type="button"
            aria-label="Limpiar la búsqueda"
            // mousedown y no click: el blur del campo corre antes y cerraria el boton.
            onMouseDown={(e) => {
              e.preventDefault();
              setDraft("");
              setOpen(false);
              if (value !== "") onCommit("");
            }}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </span>
      {hint && (
        <p
          id={hintId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute top-full z-50 mt-1.5 hidden w-max max-w-[260px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground shadow-md group-focus-within:block group-hover:block",
            hintAlign === "right" ? "right-0" : "left-0",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
