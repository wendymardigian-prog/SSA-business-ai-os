"use client";

/**
 * La tarjeta que aparece AL INSTANTE al pasar el mouse (o al llegar con Tab) por un bloque del calendario de la Agenda:
 * el nombre completo y los detalles. Una sola por calendario (no un `Tip` por bloque: puede haber cientos), con el
 * mismo aspecto y la misma ubicacion que el tooltip del sistema (`TIP_PANEL_CLASS`, `placeTip` con el panel medido). No se abre mientras se arrastra. El contenido lo arman las funciones puras de
 * `lib/calendar/hover-content.ts`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { placeTip } from "@/lib/ui/tooltip-position";
import { TIP_PANEL_CLASS } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { HoverContent } from "@/lib/calendar/hover-content";

type Anchor = HTMLElement;

export function useCalendarHover(disabled: boolean) {
  const id = useId();
  const [state, setOpen] = useState<{ content: HoverContent; anchor: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  // Mientras se arrastra no se muestra (aunque haya quedado abierta).
  const open = disabled ? null : state;

  const show = useCallback((el: Anchor, content: HoverContent) => {
    if (disabledRef.current) return;
    setPos(null);
    setOpen({ content, anchor: el.getBoundingClientRect() });
  }, []);
  const hide = useCallback(() => {
    setOpen(null);
    setPos(null);
  }, []);

  // La tarjeta se dibuja invisible, se mide y recien ahi se ubica (como `Tip`).
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!open || !card) return;
    const r = open.anchor;
    const placed = placeTip({
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: { width: card.offsetWidth, height: card.offsetHeight },
      side: "bottom",
      align: "start",
    });
    setPos({ left: placed.left, top: placed.top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  /** Lo que se le pasa a un bloque: abre al entrar el mouse o el foco, cierra al salir. */
  const bind = useCallback(
    (content: HoverContent) => ({
      onMouseEnter: (e: MouseEvent<HTMLElement>) => show(e.currentTarget, content),
      onMouseLeave: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => show(e.currentTarget, content),
      onBlur: hide,
      "aria-describedby": id,
    }),
    [show, hide, id],
  );

  const card = (
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      hidden={!open}
      className={cn(TIP_PANEL_CLASS, "z-[70] w-[280px] max-w-[calc(100vw-1rem)] p-2.5")}
      style={
        open
          ? pos
            ? { transform: `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)` }
            : { visibility: "hidden", transform: "translate(-9999px, -9999px)" }
          : undefined
      }
    >
      {open && (
        <>
          <p className="break-words text-sm font-semibold leading-snug">{open.content.title}</p>
          <ul className="mt-1 space-y-0.5">
            {open.content.lines.map((line, i) => (
              <li key={i} className="break-words text-xs text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return { bind, card };
}

export type CalendarHoverBind = ReturnType<typeof useCalendarHover>["bind"];
