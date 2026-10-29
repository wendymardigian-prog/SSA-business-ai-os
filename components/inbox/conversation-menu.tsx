"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { BadgeCheck, BadgeX, CheckCheck, Clock, HeartHandshake, HeartOff, ListPlus, MoreHorizontal, RotateCcw } from "lucide-react";
import { NOTE_TEXT, type HeaderPlan, type MenuAction } from "@/lib/inbox/header-actions";
import { cn } from "@/lib/utils";

/**
 * El menu "⋯" de la cabecera de una conversacion: las acciones que no se usan a
 * cada rato (posponer, reabrir una pospuesta y otras) y los avisos de
 * estado como texto, que antes eran iconos que solo se entendian con el mouse
 * encima. Que va adentro lo decide `planHeaderActions`; esto solo lo dibuja.
 *
 * Se abre con clic o toque. Esc lo cierra devolviendo el foco, un toque afuera
 * tambien, y se recorre con las flechas (Inicio/Fin saltan al primero/ultimo).
 */

const ACTIONS: Record<MenuAction, { label: string; icon: typeof Clock }> = {
  snooze: { label: "Posponer conversación", icon: Clock },
  reopen: { label: "Reabrir conversación", icon: RotateCcw },
  createTask: { label: "Crear tarea", icon: ListPlus }, // @plantilla-quitar(tareas)
  noReply: { label: "No necesita respuesta", icon: CheckCheck },
  markKnown: { label: "Marcar como conocido", icon: HeartHandshake },
  unmarkKnown: { label: "Quitar la marca de conocido", icon: HeartOff },
  markCustomer: { label: "Marcar como cliente", icon: BadgeCheck },
  unmarkCustomer: { label: "Quitar la marca de cliente", icon: BadgeX },
};

export function ConversationMenu({
  plan,
  statusLabel,
  onAction,
  buttonRef,
  disabled = false,
}: {
  plan: HeaderPlan;
  statusLabel: string;
  onAction: (action: MenuAction) => void;
  /** El boton "⋯" (un panel que abre el menu se ancla a el). */
  buttonRef: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function focusItem(target: number | "first" | "last") {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = target === "first" ? 0 : target === "last" ? items.length - 1 : (current + target + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() => focusItem("first"));
          } else focusItem(1);
        } else if (event.key === "ArrowUp" && open) {
          event.preventDefault();
          focusItem(-1);
        } else if (event.key === "Home" && open) {
          event.preventDefault();
          focusItem("first");
        } else if (event.key === "End" && open) {
          event.preventDefault();
          focusItem("last");
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={plan.hasAlert ? "Más acciones (hay avisos)" : "Más acciones"}
        title="Más acciones"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
        {plan.hasAlert && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-1 shadow-lg">
          {plan.menu.length > 0 && (
            <div id={menuId} role="menu" aria-label="Acciones de la conversación">
              {plan.menu.map((action) => {
                const { label, icon: Icon } = ACTIONS[action];
                return (
                  <button
                    key={action}
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => {
                      setOpen(false);
                      onAction(action);
                    }}
                    className={cn("flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50")}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <div aria-label="Estado de la conversación" role="group" className={cn("space-y-2 px-3 py-2 text-xs", plan.menu.length > 0 && "mt-1 border-t border-border")}>
            {plan.notes.map((note) =>
              note === "status" ? (
                <p key={note} className="text-muted-foreground">
                  Estado: <span className="font-medium text-foreground">{statusLabel}</span>
                </p>
              ) : (
                <p key={note}>
                  <span className="block font-medium text-foreground">{NOTE_TEXT[note].title}</span>
                  <span className="block text-muted-foreground">{NOTE_TEXT[note].detail}</span>
                </p>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
