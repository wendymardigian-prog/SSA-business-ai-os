"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Tooltip accesible (F13): abre con hover y con foco de teclado, y describe el
 * control con aria-describedby. Sin librería: es un ⓘ con un panel.
 */
export function InfoTooltip({ text, label = "Más información" }: { text: string; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-6 z-50 w-72 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function TooltipText({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/**
 * Un tooltip para cualquier elemento (un boton de icono, el encabezado de una
 * tabla). Abre con hover y con foco de teclado, cierra con Esc y cuando la
 * pagina se desplaza.
 *
 * Se posiciona con `fixed` a partir de donde esta el disparador y no con
 * `absolute`: adentro de una tabla con `overflow-x-auto` un panel absoluto
 * queda recortado. Por eso mismo no puede ser el `InfoTooltip` de arriba, que
 * cuelga de su propio contenedor.
 */
export function Tip({
  content,
  side = "top",
  align = "center",
  className = "",
  children,
}: {
  content: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center";
  /** Clases del envoltorio del disparador (por ejemplo `w-full`). */
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: align === "start" ? rect.left : rect.left + rect.width / 2,
      y: side === "top" ? rect.top - 8 : rect.bottom + 8,
    });
  }, [align, side]);

  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    // Capture: el scroll de un contenedor interno no burbujea hasta window.
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos, hide]);

  const transform = `translate(${align === "start" ? "0" : "-50%"}, ${side === "top" ? "-100%" : "0"})`;

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={pos ? id : undefined}
      className={`inline-flex ${className}`}
    >
      {children}
      {pos && (
        <span
          id={id}
          role="tooltip"
          style={{ left: pos.x, top: pos.y, transform }}
          className="pointer-events-none fixed z-[60] max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  );
}
