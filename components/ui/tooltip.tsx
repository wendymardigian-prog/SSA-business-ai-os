"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { placeTip, type TipSide } from "@/lib/ui/tooltip-position";
import { TOUCH_HOLD_MS, TOUCH_OPEN_MS, touchMovedTooFar } from "@/lib/ui/tooltip-touch";
import { cn } from "@/lib/utils";

/**
 * EL tooltip del sistema (24/11/2026): uno solo, instantaneo y con el mismo estilo en todos lados (el del menu lateral
 * plegado). Reemplaza al `title=` del navegador, que tarda 1-2 segundos y se ve distinto en cada sistema operativo;
 * `lib/ui/no-native-title.test.ts` impide volver a usarlo.
 *
 *   - Abre al pasar el mouse (sin espera) y con el foco del TECLADO (`:focus-visible`: un clic no lo deja abierto).
 *   - En el telefono, al mantener el dedo medio segundo (`lib/ui/tooltip-touch.ts`); un toque corto hace lo de siempre.
 *   - El panel va en un portal con `position: fixed`: no lo recorta una tabla con `overflow` ni un padre con transform.
 *     Se mide despues de dibujarse y se acomoda con `placeTip` para que nunca se salga de la pantalla.
 *   - Se cierra con Esc, al desplazar, al cambiar el tamano de la ventana y al salir.
 *
 * `asChild`: con un solo elemento como hijo, le suma los eventos y el `ref` SIN agregar un envoltorio (no cambia el
 * layout ni los `truncate`). Es la forma de reemplazar un `title=`. Un elemento sin texto visible (un boton de icono)
 * necesita su propio `aria-label`: el tooltip solo lo DESCRIBE (`aria-describedby`). Si no recibe un unico elemento,
 * dibuja lo que recibio sin tooltip (nunca lanza: un tooltip no puede tumbar una pantalla).
 *
 * Sin `asChild`, envuelve al disparador en un `<span class="inline-flex">` (como siempre): sirve para un boton
 * `disabled`, que no recibe eventos del puntero.
 */
/** El aspecto del panel: lo comparten `Tip` y la tarjeta del calendario (una sola por calendario). */
export const TIP_PANEL_CLASS =
  "pointer-events-none fixed left-0 top-0 z-[60] w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg";

type Pos = { left: number; top: number };

function hasContent(content: ReactNode): boolean {
  return content !== null && content !== undefined && content !== false && content !== "";
}

function isKeyboardFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Un solo tooltip abierto a la vez, y gana el de ADENTRO: con un elemento con tooltip dentro de otro, al entrar al de
 * adentro se cierra el de afuera (como hacia el `title=` del navegador) y al salir vuelve el de afuera si el mouse
 * sigue encima.
 */
type OpenTip = { anchor: () => HTMLElement | null; open: () => void; close: () => void };
let current: OpenTip | null = null;
const covered: OpenTip[] = [];

function isHovered(el: HTMLElement | null): boolean {
  if (!el) return false;
  try {
    return el.matches(":hover");
  } catch {
    return false;
  }
}

function claim(me: OpenTip) {
  if (current && current !== me) {
    const outer = current.anchor();
    const inner = me.anchor();
    if (outer && inner && outer !== inner && outer.contains(inner)) covered.push(current);
    else covered.length = 0;
    current.close();
  }
  current = me;
}

function release(me: OpenTip) {
  if (current !== me) {
    const i = covered.indexOf(me);
    if (i >= 0) covered.splice(i, 1);
    return;
  }
  current = null;
  while (covered.length) {
    const outer = covered.pop()!;
    if (isHovered(outer.anchor())) {
      current = outer;
      outer.open();
      return;
    }
  }
}

function useTip(side: TipSide, align: "start" | "center") {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const openedByTouch = useRef(false);
  const swallowClick = useRef(false);
  const autoClose = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = useCallback(() => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);

  // Lo que ve el registro de arriba: abrir y cerrar sin pasar por `claim`/`release` (los llama el propio registro).
  const self = useRef<OpenTip>({
    anchor: () => anchorRef.current,
    open: () => setOpen(true),
    close: () => {
      setOpen(false);
      setPos(null);
    },
  });

  const hide = useCallback(() => {
    clearHold();
    if (autoClose.current) clearTimeout(autoClose.current);
    autoClose.current = null;
    openedByTouch.current = false;
    setOpen(false);
    setPos(null);
    release(self.current);
  }, [clearHold]);

  const show = useCallback(() => {
    claim(self.current);
    setOpen(true);
  }, []);
  /** El elemento que recibio el evento: alcanza aunque el componente hijo no reenvie el `ref`. */
  const remember = (event: { currentTarget: EventTarget | null }) => {
    if (event.currentTarget instanceof HTMLElement) anchorRef.current = event.currentTarget;
  };

  // Medir el panel ya dibujado (invisible) y ubicarlo.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const placed = placeTip({
      anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: { width: panel.offsetWidth, height: panel.offsetHeight },
      side,
      align,
    });
    setPos({ left: placed.left, top: placed.top });
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onOutside = (event: PointerEvent) => {
      if (!openedByTouch.current) return;
      if (anchorRef.current && event.target instanceof Node && anchorRef.current.contains(event.target)) return;
      hide();
    };
    window.addEventListener("keydown", onKey);
    // Capture: el scroll de un contenedor interno no burbujea hasta window.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", onOutside, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("pointerdown", onOutside, true);
    };
  }, [open, hide]);

  useEffect(() => {
    const me = self.current;
    return () => {
      if (hold.current) clearTimeout(hold.current.timer);
      if (autoClose.current) clearTimeout(autoClose.current);
      if (current === me) current = null;
      const i = covered.indexOf(me);
      if (i >= 0) covered.splice(i, 1);
    };
  }, []);

  const handlers = {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType === "touch") return;
      remember(event);
      show();
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") hide();
    },
    onFocus: (event: ReactFocusEvent) => {
      if (!isKeyboardFocus(event.target)) return;
      remember(event);
      show();
    },
    onBlur: () => hide(),
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      remember(event);
      clearHold();
      const timer = setTimeout(() => {
        hold.current = null;
        openedByTouch.current = true;
        swallowClick.current = true;
        show();
        if (autoClose.current) clearTimeout(autoClose.current);
        autoClose.current = setTimeout(hide, TOUCH_OPEN_MS);
      }, TOUCH_HOLD_MS);
      hold.current = { timer, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (hold.current && touchMovedTooFar(hold.current, { x: event.clientX, y: event.clientY })) clearHold();
    },
    onPointerUp: () => clearHold(),
    onPointerCancel: () => clearHold(),
    // Soltar despues de mantener no tiene que «apretar» el boton ni abrir el link.
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: ReactMouseEvent) => {
      if (openedByTouch.current || hold.current) event.preventDefault();
    },
  };

  const setAnchor = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
  }, []);

  return { id, setAnchor, panelRef, open, pos, handlers };
}

function TipPanel({
  id,
  panelRef,
  pos,
  className,
  children,
}: {
  id: string;
  panelRef: Ref<HTMLSpanElement>;
  pos: Pos | null;
  className?: string;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  const style: CSSProperties = pos
    ? { transform: `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)` }
    : { visibility: "hidden", transform: "translate(-9999px, -9999px)" };
  return createPortal(
    <span ref={panelRef} id={id} role="tooltip" style={style} className={cn(TIP_PANEL_CLASS, className)}>
      {children}
    </span>,
    document.body,
  );
}

function chain<E>(own: (event: E) => void, theirs: unknown) {
  return (event: E) => {
    if (typeof theirs === "function") (theirs as (event: E) => void)(event);
    own(event);
  };
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") (ref as { current: T | null }).current = node;
    }
  };
}

export function Tip({
  content,
  side = "top",
  align = "center",
  asChild = false,
  className = "",
  panelClassName,
  children,
}: {
  /** `null`, `false` o `""` lo apagan sin desmontar el disparador. */
  content: ReactNode;
  /** `right`: al costado, centrado en el alto del disparador (los iconos del menu lateral plegado). */
  side?: TipSide;
  align?: "start" | "center";
  /** Sin envoltorio: el unico hijo recibe los eventos. La forma de reemplazar un `title=`. */
  asChild?: boolean;
  /** Clases del envoltorio (solo sin `asChild`; por ejemplo `w-full`, o `flex`/`hidden`, que reemplazan al `inline-flex`). */
  className?: string;
  /** Clases extra del panel (por ejemplo el ancho fijo del ⓘ). */
  panelClassName?: string;
  children: ReactNode;
}) {
  const { id, setAnchor, panelRef, open, pos, handlers } = useTip(side, align);
  const enabled = hasContent(content);
  const panel =
    enabled && open ? (
      <TipPanel id={id} panelRef={panelRef} pos={pos} className={panelClassName}>
        {content}
      </TipPanel>
    ) : null;

  if (asChild) {
    // `Children.toArray`, no `Children.only`: un hijo que llega desde un componente de servidor puede venir en otra tanda
    // del payload y en el navegador es un lazy de React, no un elemento. `only` lo rechaza y tumbaba la pagina entera
    // (la ficha del cliente, 24/11); `toArray` lo desenvuelve. Sin un unico elemento, se dibuja sin tooltip, nunca lanza.
    const items = Children.toArray(children);
    const child = items.length === 1 ? items[0] : null;
    if (!isValidElement(child) || !enabled) return <>{children}</>;
    const element = child as ReactElement<Record<string, unknown> & { ref?: Ref<HTMLElement> }>;
    const props = element.props;
    const extra: Record<string, unknown> = {
      // Se lee el ref del hijo (no su valor) solo para no pisarlo al clonarlo: React 19 lo pasa como una prop mas.
      // eslint-disable-next-line react-hooks/refs
      ref: mergeRefs<HTMLElement>(props.ref, setAnchor),
      style: { WebkitTouchCallout: "none", ...(props.style as CSSProperties | undefined) },
    };
    for (const [name, handler] of Object.entries(handlers)) {
      extra[name] = chain(handler as (event: unknown) => void, props[name]);
    }
    if (open) extra["aria-describedby"] = [props["aria-describedby"], id].filter(Boolean).join(" ");
    return (
      <>
        {cloneElement(element, extra)}
        {panel}
      </>
    );
  }

  return (
    <span
      ref={setAnchor}
      {...(enabled ? handlers : {})}
      aria-describedby={enabled && open ? id : undefined}
      style={enabled ? { WebkitTouchCallout: "none" } : undefined}
      className={cn("inline-flex", className)}
    >
      {children}
      {panel}
    </span>
  );
}

/**
 * El ⓘ con su explicacion (F13): un boton chico que abre el mismo tooltip del sistema, mas ancho y con mas aire.
 */
export function InfoTooltip({ text, label = "Más información" }: { text: string; label?: string }) {
  return (
    <span className="relative inline-flex">
      <Tip asChild content={text} side="bottom" align="start" panelClassName="w-72 max-w-[calc(100vw-1rem)] p-3">
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full max-topbar:-m-2.5 max-topbar:h-10 max-topbar:w-10 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Info className="h-4 w-4" aria-hidden />
        </button>
      </Tip>
    </span>
  );
}

export function TooltipText({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}
