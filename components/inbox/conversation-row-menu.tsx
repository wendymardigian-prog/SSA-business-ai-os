"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, BadgeX, ExternalLink, HeartHandshake, HeartOff, Loader2, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RowAction } from "@/lib/inbox/row-actions";

/**
 * El "⋯" de una fila de la lista de chats. Lo que va adentro lo decide
 * `planRowActions`; esto solo lo dibuja. No abre la conversacion (ni la marca
 * como leida): es para actuar sin entrar.
 *
 * Se abre con clic o toque; Esc y un toque afuera lo cierran; se recorre con
 * las flechas.
 */

const LABELS: Record<Exclude<RowAction, "openContact">, { label: string; icon: typeof HeartHandshake; className?: string }> = {
  markCustomer: { label: "Marcar como cliente", icon: BadgeCheck, className: "text-emerald-600 dark:text-emerald-400" },
  unmarkCustomer: { label: "Quitar la marca de cliente", icon: BadgeX },
  markKnown: { label: "Marcar como conocido", icon: HeartHandshake, className: "text-violet-600 dark:text-violet-400" },
  unmarkKnown: { label: "Quitar la marca de conocido", icon: HeartOff },
};

export function ConversationRowMenu({
  actions,
  contactId,
  contactName,
  pending,
  onAction,
}: {
  actions: RowAction[];
  contactId: string | null;
  contactName: string;
  pending: boolean;
  onAction: (action: Exclude<RowAction, "openContact">) => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (actions.length === 0) return null;

  function focusItem(step: number) {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + step + items.length) % items.length]?.focus();
  }

  const itemClass = "flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none";

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
            requestAnimationFrame(() => focusItem(1));
          } else focusItem(1);
        } else if (event.key === "ArrowUp" && open) {
          event.preventDefault();
          focusItem(-1);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Acciones de la conversación con ${contactName}`}
        title="Acciones"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-accent text-foreground",
        )}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MoreVertical className="h-4 w-4" aria-hidden />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Acciones de la conversación con ${contactName}`}
          className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {actions.map((action) =>
            action === "openContact" ? (
              contactId && (
                <Link
                  key={action}
                  role="menuitem"
                  href={`/dashboard/contacts/${contactId}`}
                  onClick={() => setOpen(false)}
                  className={cn(itemClass, "border-t border-border")}
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Abrir la ficha del contacto
                </Link>
              )
            ) : (
              <button
                key={action}
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  onAction(action);
                }}
                className={cn(itemClass, "disabled:opacity-50")}
              >
                {(() => {
                  const { icon: Icon, className } = LABELS[action];
                  return <Icon className={cn("h-4 w-4", className ?? "text-muted-foreground")} aria-hidden />;
                })()}
                {LABELS[action].label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
