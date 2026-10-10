"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Un panel lateral sobre un fondo oscurecido (la hoja que sube desde el
 * costado). Cierra con Esc y con un clic en el fondo; al abrir el foco pasa
 * al boton de cerrar y al cerrar vuelve a donde estaba.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // El padre suele pasar una funcion nueva en cada render; si el efecto
  // dependiera de ella, volveria a mandar el foco al boton de cerrar en
  // medio de lo que alguien esta escribiendo.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto border-l border-border bg-background shadow-xl sm:max-w-md"
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}
