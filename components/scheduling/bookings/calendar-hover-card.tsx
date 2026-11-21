"use client";

/**
 * La tarjeta que aparece AL INSTANTE al pasar el mouse (o al llegar con Tab) por un bloque del calendario de la Agenda:
 * el nombre completo y los detalles. Una sola por calendario, `position: fixed`, ubicada con `placeTooltip` para que
 * entre en la pantalla. No se abre mientras se arrastra. El contenido lo arman las funciones puras de
 * `lib/calendar/hover-content.ts`.
 */
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { placeTooltip, type TooltipPlacement } from "@/lib/ui/tooltip-position";
import type { HoverContent } from "@/lib/calendar/hover-content";

const WIDTH = 280;
const HEIGHT_GUESS = 150;

type Anchor = HTMLElement;

export function useCalendarHover(disabled: boolean) {
  const id = useId();
  const [state, setOpen] = useState<{ content: HoverContent; placement: TooltipPlacement } | null>(null);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  // Mientras se arrastra no se muestra (aunque haya quedado abierta).
  const open = disabled ? null : state;

  const show = useCallback((el: Anchor, content: HoverContent) => {
    if (disabledRef.current) return;
    const rect = el.getBoundingClientRect();
    setOpen({
      content,
      placement: placeTooltip({
        anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        width: WIDTH,
        height: HEIGHT_GUESS,
      }),
    });
  }, []);
  const hide = useCallback(() => setOpen(null), []);

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
      id={id}
      role="tooltip"
      hidden={!open}
      className="pointer-events-none fixed z-[70] rounded-lg border border-border bg-popover p-2.5 text-left text-popover-foreground shadow-lg"
      style={
        open
          ? { left: open.placement.left, top: open.placement.top, width: open.placement.width, transform: open.placement.above ? "translateY(-100%)" : undefined }
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
