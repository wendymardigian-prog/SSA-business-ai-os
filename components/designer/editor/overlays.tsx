"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las capas del Diseñador IA: el modal centrado (en el celular, pantalla completa con el botón principal fijo
 * abajo, §11.1), el drawer de la derecha (Configuración) y la hoja inferior del celular (paneles del editor).
 *
 * Las tres: Esc cierra, el foco entra al abrirse y vuelve a donde estaba, Tab no se escapa a lo de atrás y el fondo
 * no se desplaza.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useLayer(onClose: () => void, panel: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input:not([type=file]), textarea, select, button:not([data-close])");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key === "Tab" && panel.current) {
        event.stopPropagation();
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (!firstItem || !lastItem) return;
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [panel]);
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" data-close onClick={onClose} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** Un modal: 620 px en la computadora y pantalla completa en el celular, con el pie fijo abajo. */
export function DesignerDialog({
  title,
  label,
  onClose,
  children,
  footer,
  wide = false,
  header,
}: {
  title: ReactNode;
  label: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Algo fijo debajo del título (el indicador de pasos). */
  header?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayer(onClose, panel);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "flex h-full w-full flex-col bg-background shadow-xl sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:border sm:border-border",
          wide ? "sm:max-w-[860px]" : "sm:max-w-[620px]",
        )}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          <CloseButton onClose={onClose} />
        </header>
        {header && <div className="border-b border-border px-4 py-2.5">{header}</div>}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>
  );
}

/** El drawer de la derecha (Configuración): 520 px en la computadora y pantalla completa en el celular. */
export function DesignerDrawer({ title, label, onClose, children }: { title: ReactNode; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useLayer(onClose, panel);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={label} className="flex h-full w-full max-w-full flex-col border-l border-border bg-background shadow-xl sm:max-w-[520px]">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          <CloseButton onClose={onClose} />
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </aside>
    </div>
  );
}

/** La hoja inferior del celular: sube desde abajo hasta el 85 % del alto (paneles del editor, barra del elemento). */
export function BottomSheet({ title, label, onClose, children, tabs }: { title: ReactNode; label: string; onClose: () => void; children: ReactNode; tabs?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayer(onClose, panel);
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:hidden" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className="flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-border bg-background shadow-xl">
        <header className="relative flex items-center gap-2 border-b border-border px-4 py-2.5 pt-4">
          <div aria-hidden className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-muted-foreground/30" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <CloseButton onClose={onClose} />
        </header>
        {tabs && <div className="border-b border-border px-3">{tabs}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:border-primary-edge focus:outline-none";
export const textareaClass = "w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-primary-edge focus:outline-none";
export const primaryButton = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
export const smallButton = "inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
