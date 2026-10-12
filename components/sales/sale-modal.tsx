"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * El modal ancho de Ventas (asistente de venta, cobrar un pago, cancelar). Mismo comportamiento
 * que `ContentDialog` (Esc cierra, el foco entra y vuelve, el fondo no se mueve) pero con
 * ancho a elección: el asistente necesita tres pasos con tablas, no 512 px.
 */
const SIZES = { md: "max-w-lg", lg: "max-w-3xl" } as const;

export function SaleModal({
  title,
  label,
  onClose,
  children,
  footer,
  size = "md",
  header,
}: {
  title: React.ReactNode;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  size?: keyof typeof SIZES;
  /** Debajo del título (el indicador de pasos). */
  header?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous.current?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={`flex max-h-[94vh] w-full ${SIZES[size]} flex-col rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl`}>
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
            <button type="button" data-close onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {header}
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">{footer}</footer>
      </div>
    </div>
  );
}
