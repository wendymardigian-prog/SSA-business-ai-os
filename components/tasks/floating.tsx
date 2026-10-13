"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Un panel flotante anclado a un elemento, con posicion FIJA.
 *
 * La tabla tiene scroll propio y un panel `absolute` adentro se corta. Este se posiciona contra la
 * ventana, se da vuelta hacia arriba si no entra abajo, y se cierra con Esc, con un clic afuera o al
 * desplazar la pagina (si no, queda flotando donde ya no hay nada).
 */
export function FloatingPanel({
  anchor,
  onClose,
  children,
  className,
  label,
  width = 260,
}: {
  anchor: RefObject<HTMLElement | null>;
  /** `escape` = la persona cancelo; `outside` = hizo clic afuera o desplazo la pagina. */
  onClose: (reason: "escape" | "outside") => void;
  children: ReactNode;
  className?: string;
  label: string;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // La posicion se escribe directo sobre el nodo (no es estado de React): se mide contra el ancla y la ventana.
  useLayoutEffect(() => {
    place();
    function place() {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (!a || !p) return;
      const margin = 8;
      const height = p.offsetHeight;
      const left = Math.min(Math.max(margin, a.left), Math.max(margin, window.innerWidth - width - margin));
      const below = window.innerHeight - a.bottom - margin;
      const top = below >= height || below >= a.top ? a.bottom + 4 : Math.max(margin, a.top - height - 4);
      p.style.top = `${top}px`;
      p.style.left = `${left}px`;
      p.style.maxHeight = `${Math.max(160, Math.min(360, window.innerHeight - 2 * margin))}px`;
      p.style.visibility = "visible";
    }
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, width]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current("escape");
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      closeRef.current("outside");
    };
    const onScroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      closeRef.current("outside");
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
      className={cn("z-[65] overflow-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg", className)}
    >
      {children}
    </div>
  );
}
