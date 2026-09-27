"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { activeDashboard, type DashboardOption } from "@/lib/dashboards/available";

/**
 * El selector de dashboards, en la barra superior (F48, B2).
 *
 * Un menu desplegable y no una fila de pastillas: son cuatro destinos con
 * nombres largos, y en el celular la fila se iba de pantalla. Cada opcion
 * lleva una linea de que se ve ahi, porque "Unificado" no le dice nada a
 * nadie la primera vez.
 *
 * Siguen siendo links: se pueden abrir en otra pestaña y el navegador los
 * precarga. Lo que cambia es como se muestran.
 *
 * Teclado completo: Enter o Espacio abre, las flechas recorren, Home y End
 * van a los extremos, Esc cierra y devuelve el foco al boton.
 */

export function DashboardSwitcher({ options }: { options: DashboardOption[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const current = activeDashboard(pathname);
  const label = current?.label ?? "Dashboards";

  // Cerrar al hacer clic afuera. Sin esto el menu queda abierto mientras se
  // usa la pantalla de atras.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
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

  // El foco entra al menu al abrirlo: si no, tabular sigue por la pantalla
  // de atras y el menu queda flotando sin dueño.
  useEffect(() => {
    if (open) itemRefs.current[focused]?.focus();
  }, [open, focused]);

  if (options.length === 0) return null;

  const openAt = (index: number) => {
    setFocused(index);
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(Math.max(0, options.findIndex((o) => o.key === current?.key)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(options.length - 1);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocused((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocused((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocused(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocused(options.length - 1);
    } else if (event.key === "Tab") {
      // Tabular afuera cierra: el menu no atrapa a nadie.
      setOpen(false);
    }
  };

  return (
    <div className="relative ml-2">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openAt(Math.max(0, options.findIndex((o) => o.key === current?.key))))}
        onKeyDown={onButtonKeyDown}
        className="flex max-w-[45vw] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium hover:bg-accent/60 sm:max-w-none"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Dashboards"
          onKeyDown={onMenuKeyDown}
          // En el celular el boton esta a mitad de la barra, asi que un menu
          // anclado a el se sale de la pantalla: ahi se pega a los bordes.
          className="fixed inset-x-4 top-14 z-50 rounded-xl border border-border bg-popover p-1 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-[19rem]"
        >
          <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Dashboards
          </p>
          {options.map((option, index) => {
            const active = option.key === current?.key;
            return (
              <Link
                key={option.key}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                href={option.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                tabIndex={index === focused ? 0 : -1}
                onClick={() => setOpen(false)}
                onFocus={() => setFocused(index)}
                className="flex items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-accent focus:bg-accent focus:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
                {active && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
