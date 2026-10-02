"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El envoltorio de los filtros de la barra: un boton y un menu propio.
 *
 * Por que no un `<select>` nativo: cada opcion lleva un punto de color, un
 * estado ("Conectado" / "Sin conectar"), un avatar y una linea de explicacion.
 * Un `<option>` solo admite texto plano.
 *
 * Lo que un `<select>` daba gratis y hay que reponer a mano: abrir con Enter,
 * Espacio y las flechas, recorrer con las flechas, Home y End, cerrar con Esc
 * devolviendo el foco al boton, y cerrar al hacer clic afuera. El menu es
 * `role="menu"` y cada opcion `role="menuitemradio"`, asi un lector de pantalla
 * anuncia cual esta elegida.
 */

/**
 * El cierre del menu, por contexto.
 *
 * Antes iba como render prop (`children(close)`), pero llamar a `children`
 * durante el render con una funcion que toca un ref es justo lo que React 19
 * marca como error. Por contexto, cada opcion pide el cierre cuando lo necesita.
 */
const CloseContext = createContext<(() => void) | null>(null);

export function FilterMenu({
  label,
  value,
  active,
  icon,
  children,
  align = "right",
  menuClassName = "topbar:w-[300px]",
}: {
  /** El nombre del filtro, en gris ("Canal:"). Se esconde en pantallas chicas. */
  label: string;
  /** Lo elegido, en negro. */
  value: ReactNode;
  /** Hay un filtro puesto: el boton se resalta. */
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /**
   * El ancho del menu en la computadora, como clase completa (por ejemplo
   * `topbar:w-[300px]`). Completa y no interpolada: Tailwind genera las clases
   * leyendo el codigo, y una clase armada con un template no existe.
   */
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Al abrir, el foco entra al menu: si no, tabular sigue por la pantalla de
  // atras y el menu queda flotando sin dueño.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not([disabled]), button:not([disabled])');
    first?.focus();
  }, [open]);

  // Estable y con useCallback: el menu la recibe como prop, y crear la funcion
  // en cada render la haria "acceder al ref durante el render" para el linter.
  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);
  const closeFromChild = useCallback(() => close(true), [close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled]), button:not([disabled])') ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
          active ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60",
        )}
      >
        {icon}
        <span className="hidden font-normal text-muted-foreground md:inline">{label}:</span>
        <span>{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "fixed inset-x-4 top-28 z-50 max-h-[70vh] overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg",
            "topbar:absolute topbar:inset-x-auto topbar:top-full topbar:mt-2",
            align === "right" ? "topbar:right-0" : "topbar:left-0",
            menuClassName,
          )}
        >
          <CloseContext.Provider value={closeFromChild}>{children}</CloseContext.Provider>
        </div>
      )}
    </div>
  );
}

/** El titulo de un grupo de opciones ("Agente", "Personas del equipo"). */
export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Una opcion del menu: punto o avatar, nombre, explicacion y el tilde. */
export function MenuOption({
  checked,
  onSelect,
  leading,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  leading?: ReactNode;
  title: string;
  description?: string | null;
  disabled?: boolean;
}) {
  const close = useContext(CloseContext);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onSelect();
        // Elegir cierra: es un filtro de una sola opcion.
        close?.();
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      {checked && <span className="text-primary" aria-hidden>✓</span>}
    </button>
  );
}

/** El punto de color de un canal. */
export function ColorDot({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

/** El avatar redondo de una persona o de un grupo. */
export function Avatar({ initials, color, size = "md" }: { initials: string; color: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-white",
        size === "sm" ? "h-[18px] w-[18px] text-[9px]" : "h-[22px] w-[22px] text-[10px]",
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
