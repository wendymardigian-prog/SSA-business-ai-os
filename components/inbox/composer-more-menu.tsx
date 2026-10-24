"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Library, Loader2, MoreHorizontal, Paperclip, Smile, Sparkles, Sticker } from "lucide-react";
import type { ComposerMenuAction } from "@/lib/inbox/composer-actions";

/**
 * El "⋯" del composer: agrupa recursos guardados, adjuntar, emoji, stickers y
 * sugerir respuesta, en todos los anchos (que mostrar lo decide
 * `planComposerActions`). Se abre con un clic, cierra con Esc (y devuelve el
 * foco al "⋯") o con un clic afuera, y se recorre con las flechas, Inicio y Fin.
 *
 * El emoji y los stickers abren su propio panel (lo dibuja quien usa el menu,
 * anclado al mismo lugar): el menu solo avisa con `onAction`.
 */
export function ComposerMoreMenu({
  actions,
  onAction,
  suggesting = false,
  libraryOpen = false,
  shortcutLabel,
  stickerDisabledReason = null,
}: {
  actions: ComposerMenuAction[];
  onAction: (action: ComposerMenuAction) => void;
  suggesting?: boolean;
  /** El widget de recursos esta abierto (el item lo cierra). */
  libraryOpen?: boolean;
  /** El atajo de los recursos (⌘/ o Ctrl+/), para mostrarlo al lado. */
  shortcutLabel?: string;
  /** Por que no se pueden mandar stickers ahora (el item queda deshabilitado). */
  stickerDisabledReason?: string | null;
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
    // Con el teclado, el foco entra al primer item al abrir.
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function items() {
    return Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
  }

  function move(to: number | "first" | "last") {
    const list = items();
    if (list.length === 0) return;
    if (to === "first") return list[0].focus();
    if (to === "last") return list[list.length - 1].focus();
    const current = list.indexOf(document.activeElement as HTMLElement);
    list[(current + to + list.length) % list.length]?.focus();
  }

  function choose(action: ComposerMenuAction) {
    setOpen(false);
    onAction(action);
  }

  if (actions.length === 0) return null;

  const labels: Record<ComposerMenuAction, { icon: ReactNode; label: string; hint?: string; disabled?: boolean; title?: string }> = {
    library: { icon: <Library className="h-4 w-4" aria-hidden />, label: libraryOpen ? "Cerrar recursos guardados" : "Recursos guardados", hint: shortcutLabel },
    attach: { icon: <Paperclip className="h-4 w-4" aria-hidden />, label: "Adjuntar archivo" },
    emoji: { icon: <Smile className="h-4 w-4" aria-hidden />, label: "Emoji" },
    sticker: {
      icon: <Sticker className="h-4 w-4" aria-hidden />,
      label: "Stickers",
      disabled: !!stickerDisabledReason,
      title: stickerDisabledReason ?? undefined,
    },
    suggest: {
      icon: suggesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />,
      label: suggesting ? "Preparando una sugerencia…" : "Sugerir respuesta con IA",
      disabled: suggesting,
    },
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          move("first");
        } else if (event.key === "End") {
          event.preventDefault();
          move("last");
        } else if (event.key === "Tab") {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Más opciones"
        title="Más opciones"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          // Flecha arriba en el boton cerrado abre el menu (sale hacia arriba).
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Más opciones del mensaje"
          className="absolute bottom-full right-0 z-50 mb-2 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {actions.map((action) => {
            const item = labels[action];
            return (
              <button
                key={action}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => choose(action)}
                className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50"
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <kbd className="font-sans text-xs text-muted-foreground">{item.hint}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
