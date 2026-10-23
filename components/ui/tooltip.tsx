"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { placeTooltip, type TooltipPlacement } from "@/lib/ui/tooltip-position";

/**
 * Tooltip accesible (F13): abre con hover y con foco de teclado, y describe el
 * control con aria-describedby. Sin librería: es un ⓘ con un panel.
 *
 * El panel va con `position: fixed` y se acomoda con `placeTooltip`
 * (lib/ui/tooltip-position.ts): antes colgaba del icono hacia la derecha y en la
 * última tarjeta del dashboard se salía de la pantalla. Se cierra con Esc y al
 * desplazar (la posición se calculó para donde estaba el icono).
 */
const INFO_WIDTH = 288;
/** Alto aproximado de un texto de tres o cuatro líneas: solo decide arriba o abajo. */
const INFO_HEIGHT_GUESS = 120;

export function InfoTooltip({ text, label = "Más información" }: { text: string; label?: string }) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPlacement(
      placeTooltip({
        anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        width: INFO_WIDTH,
        height: INFO_HEIGHT_GUESS,
      }),
    );
  }, []);
  const hide = useCallback(() => setPlacement(null), []);

  useEffect(() => {
    if (!placement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [placement, hide]);

  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={placement ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {placement && (
        <span
          id={id}
          role="tooltip"
          style={{
            left: placement.left,
            top: placement.top,
            width: placement.width,
            transform: placement.above ? "translateY(-100%)" : undefined,
          }}
          className="pointer-events-none fixed z-[60] rounded-lg border border-border bg-popover p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg"
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
  /** `null` o `false` lo apagan sin desmontar el disparador. */
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
      {/* Sin contenido no hay tooltip (por ejemplo, mientras el desplegable
          que abre el mismo boton esta abierto). */}
      {pos && content !== null && content !== false && (
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
