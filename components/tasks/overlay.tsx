"use client";

import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Las dos capas de Tareas: el panel lateral (drawer) y el dialogo centrado.
 *
 * Comparten lo que hace falta para usarlas sin mouse: Esc cierra, el fondo no se desplaza, Tab no se
 * escapa del panel y, al cerrar, el foco vuelve a quien lo abrio. Es la misma regla que el drawer de
 * Contenido; `components/ui/sheet.tsx` no se toca (es angosto y fijo).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useLayer(onClose: () => void, returnFocus?: MutableRefObject<HTMLElement | null>) {
  const panel = useRef<HTMLElement>(null);
  // Siempre la ultima `onClose`, sin volver a enganchar el teclado en cada render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const node = panel.current;
    node?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) {
          event.preventDefault();
          node.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === node)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

  // El foco vuelve a quien abrio la capa. Se lee AL desmontar a proposito: es la ultima fila tocada.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const origin = returnFocus?.current;
      if (origin && origin.isConnected) origin.focus();
    };
  }, [returnFocus]);

  return { panel, closeRef };
}

/** El panel lateral de la tarea: ~640 px en la computadora, pantalla completa en el celular. */
export function SidePanel({
  label,
  header,
  footer,
  children,
  onClose,
  returnFocus,
}: {
  label: string;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: MutableRefObject<HTMLElement | null>;
}) {
  const { panel, closeRef } = useLayer(onClose, returnFocus);
  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0 bg-black/40" onMouseDown={() => closeRef.current()} />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-task-drawer
        className="absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-border bg-background shadow-xl outline-none sm:w-[640px]"
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">{header}</header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

/** Un dialogo centrado (la vista previa de fechas, la confirmacion de borrar). Esc y el fondo NO confirman. */
export function CenterDialog({
  label,
  children,
  onClose,
  className,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const { panel, closeRef } = useLayer(onClose);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/50" onMouseDown={() => closeRef.current()} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn("relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-xl outline-none", className)}
      >
        {children}
      </section>
    </div>
  );
}
