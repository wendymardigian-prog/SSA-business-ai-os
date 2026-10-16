"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Library, Paperclip, Plus, Sparkles } from "lucide-react";

/**
 * El "+" del composer en el telefono: agrupa recursos guardados, adjuntar y
 * sugerir respuesta, que en pantallas grandes son botones sueltos. Se abre con
 * un toque, cierra con Esc o tocando afuera, y se recorre con las flechas.
 */
export function ComposerMoreMenu({
  showLibrary,
  showAttach,
  showSuggest,
  onLibrary,
  onAttach,
  onSuggest,
  suggesting = false,
}: {
  showLibrary: boolean;
  showAttach: boolean;
  showSuggest: boolean;
  onLibrary: () => void;
  onAttach: () => void;
  onSuggest: () => void;
  suggesting?: boolean;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function move(delta: number) {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + delta + items.length) % items.length]?.focus();
  }

  const item = "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50";

  return (
    <div
      ref={rootRef}
      className="relative sm:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        } else if (event.key === "ArrowDown" && open) {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowUp" && open) {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Más opciones"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
      >
        <Plus className={`h-5 w-5 transition-transform ${open ? "rotate-45" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Más opciones del mensaje" className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg">
          {showLibrary && (
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onLibrary(); }}>
              <Library className="h-4 w-4 text-muted-foreground" aria-hidden /> Recursos guardados
            </button>
          )}
          {showAttach && (
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onAttach(); }}>
              <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden /> Adjuntar archivo
            </button>
          )}
          {showSuggest && (
            <button type="button" role="menuitem" disabled={suggesting} className={item} onClick={() => { setOpen(false); onSuggest(); }}>
              <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden /> Sugerir respuesta
            </button>
          )}
        </div>
      )}
    </div>
  );
}
