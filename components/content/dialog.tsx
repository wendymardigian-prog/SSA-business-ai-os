"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * El modal de contenido (C2, C3).
 *
 * Crear una idea o un post era una pagina aparte: se perdia el tablero de
 * vista y volver costaba dos clics. En el prototipo son modales encima del
 * kanban, que es donde estaba la cabeza de quien los abre.
 *
 * Esc cierra, el foco entra al abrirse y vuelve al cerrarse, y el fondo no
 * hace scroll: lo minimo para que se pueda usar sin mouse.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ContentDialog({
  title,
  label,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  /** Para el lector de pantalla, cuando el titulo no es texto. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([data-close])",
    );
    first?.focus();

    // En captura y cortando la propagacion: un modal abierto encima del drawer
    // de la pieza tiene que quedarse con Esc (cierra el modal, no el drawer) y
    // con Tab (el foco no se escapa al drawer de atras).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Tab" && panel.current) {
        event.stopPropagation();
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => el.offsetParent !== null,
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previous.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">{children}</div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {footer}
        </footer>
      </div>
    </div>
  );
}

export const fieldInput =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export function DialogField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
