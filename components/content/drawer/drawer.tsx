"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * El drawer de contenido: un panel que entra por la derecha (F95, F96).
 *
 * Mide ~560 px para una idea y ~900 px para una pieza; en el celular ocupa la
 * pantalla completa. La pagina de atras no se va: el tablero sigue ahi.
 *
 * Esc cierra, el fondo no hace scroll, Tab no se escapa del panel, y al cerrar
 * el foco vuelve a la tarjeta que lo abrio (si la tarjeta ya no esta, a la que
 * tenga el mismo `data-card`). Es lo minimo para poder usarlo sin mouse.
 *
 * Tres zonas: cabecera y pie fijos, cuerpo que scrollea. El pie no se pierde
 * en una pieza larga (C6).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({
  size,
  label,
  header,
  footer,
  children,
  onClose,
  returnFocus,
}: {
  size: "idea" | "piece";
  /** Para el lector de pantalla. */
  label: string;
  header: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  /** El elemento que lo abrio, para devolverle el foco al cerrar. */
  returnFocus?: MutableRefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLElement>(null);
  // Siempre la ultima `onClose`, sin volver a enganchar el teclado en cada
  // render. Se actualiza en un efecto y no durante el render: leer o escribir
  // un ref mientras se dibuja puede dar un resultado distinto segun cuando
  // React decida dibujar.
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

  // El foco vuelve a quien abrio el drawer. Va aparte, solo al desmontar.
  useEffect(() => {
    return () => {
      const origin = returnFocus?.current;
      if (origin && origin.isConnected) origin.focus();
    };
  }, [returnFocus]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40"
        onMouseDown={() => closeRef.current()}
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-drawer={size}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-border bg-background shadow-xl outline-none",
          size === "idea" ? "sm:w-[560px]" : "sm:w-[900px]",
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">{header}</header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
