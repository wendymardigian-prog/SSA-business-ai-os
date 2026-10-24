"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { EmojiPicker } from "frimousse";
import { Smile } from "lucide-react";
import { insertAtCursor } from "@/lib/response-assets/insert";

type TextTarget = HTMLTextAreaElement | HTMLInputElement;

/**
 * Hook para campos de texto controlados: devuelve `insert(emoji)`, que mete el
 * emoji donde esta el cursor (reemplazando la seleccion) SIN borrar lo escrito
 * y deja el cursor justo despues. Sirve para varios emojis seguidos: el cursor
 * se recuerda entre inserciones aunque el campo no tenga el foco.
 */
export function useEmojiInsert(
  ref: RefObject<TextTarget | null>,
  value: string,
  onChange: (next: string) => void,
) {
  const caretRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  return useCallback(
    (emoji: string) => {
      const el = ref.current;
      const start = caretRef.current ?? el?.selectionStart ?? null;
      const end = caretRef.current ?? el?.selectionEnd ?? null;
      const next = insertAtCursor(valueRef.current, start, end, emoji);
      caretRef.current = next.caret;
      valueRef.current = next.value;
      onChange(next.value);
      // React vuelve a escribir el valor y manda el cursor al final: se repone.
      requestAnimationFrame(() => {
        try {
          ref.current?.setSelectionRange(next.caret, next.caret);
        } catch {
          /* un input de tipo que no admite seleccion */
        }
      });
    },
    [ref, onChange],
  );
}

/**
 * El boton de emojis: abre un selector con busqueda en espanol y categorias.
 *
 *  - Se abre con clic o toque, nunca con hover. En pantallas chicas sube como
 *    hoja desde abajo; en grandes es un panel junto al boton.
 *  - Elegir NO lo cierra: se pueden poner varios seguidos. Esc o un clic
 *    afuera lo cierran y el foco vuelve al campo.
 *  - Los datos se sirven de `/emoji/es` (copia de emojibase-data): no depende
 *    de ningun CDN.
 */
export function EmojiButton({
  onPick,
  focusRef,
  placement = "top",
  align = "start",
  className = "",
  label = "Insertar emoji",
  disabled = false,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  onPick: (emoji: string) => void;
  /** El campo al que vuelve el foco al cerrar. */
  focusRef?: RefObject<TextTarget | null>;
  placement?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
  label?: string;
  disabled?: boolean;
  /** Controlado desde afuera (el "⋯" del composer lo abre sin boton propio). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Sin boton: el panel se ancla al contenedor y lo abre quien controla `open`. */
  hideTrigger?: boolean;
}) {
  const id = useId();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    (focusRef?.current ?? buttonRef.current)?.focus();
  }, [focusRef, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, setOpen]);

  return (
    <div ref={rootRef} className={hideTrigger ? "pointer-events-none absolute inset-0 [&>*]:pointer-events-auto" : "relative"}>
      {!hideTrigger && <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
        className={
          className ||
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        }
      >
        <Smile className="h-5 w-5" aria-hidden />
      </button>}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div
            id={id}
            role="dialog"
            aria-label={label}
            className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-border bg-popover text-popover-foreground shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:w-80 sm:rounded-xl ${
              placement === "top" ? "sm:bottom-full sm:mb-2" : "sm:top-full sm:mt-2"
            } ${align === "end" ? "sm:right-0" : "sm:left-0"}`}
          >
            <EmojiPickerPanel onPick={onPick} onDone={close} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * El selector en si (busqueda en espanol, categorias y lista), sin boton ni
 * popover: lo usa `EmojiButton` y cualquier panel que ya tenga su propio
 * contenedor (el menu de reacciones de la bandeja).
 */
export function EmojiPickerPanel({
  onPick,
  onDone,
  className = "h-[min(24rem,70vh)]",
}: {
  onPick: (emoji: string) => void;
  /** Muestra un boton "Listo" en pantallas chicas (la hoja inferior lo necesita para cerrarse). */
  onDone?: () => void;
  className?: string;
}) {
  return (
    <EmojiPicker.Root
      locale="es"
      emojibaseUrl="/emoji"
      columns={8}
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className={`isolate flex w-full flex-col ${className}`}
    >
      <EmojiPicker.Search
        autoFocus
        aria-label="Buscar emoji"
        placeholder="Buscar (corazón, risa, fuego…)"
        className="m-2 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
      />
      <EmojiPicker.Viewport className="relative flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Cargando…
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No encontramos ese emoji.
        </EmojiPicker.Empty>
        <EmojiPicker.List
          className="select-none pb-2"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div {...props} className="bg-popover px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className="scroll-my-1 px-2">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button {...props} className="flex size-9 items-center justify-center rounded-md text-xl data-[active]:bg-accent">
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
      {onDone && (
        <button type="button" onClick={onDone} className="border-t border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent sm:hidden">
          Listo
        </button>
      )}
    </EmojiPicker.Root>
  );
}

/**
 * Emoji para un campo de texto que se ubica por su `id` (editores de
 * automatizaciones y secuencias, donde el valor vive en un objeto `data`).
 * Mismo patron que "Insertar recurso": lee el cursor del campo en el momento
 * de elegir, inserta ahi y repone el cursor despues de lo insertado.
 */
export function FieldEmojiButton({
  targetId,
  value,
  onChange,
  disabled = false,
  compact = true,
}: {
  targetId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const valueRef = useRef(value);
  const caretRef = useRef<number | null>(null);
  useEffect(() => {
    valueRef.current = value;
    caretRef.current = null;
  }, [value]);

  const pick = useCallback(
    (emoji: string) => {
      const field = document.getElementById(targetId) as TextTarget | null;
      const start = caretRef.current ?? field?.selectionStart ?? null;
      const end = caretRef.current ?? field?.selectionEnd ?? null;
      const next = insertAtCursor(valueRef.current, start, end, emoji);
      valueRef.current = next.value;
      caretRef.current = next.caret;
      onChange(next.value);
      requestAnimationFrame(() => {
        try {
          (document.getElementById(targetId) as TextTarget | null)?.setSelectionRange(next.caret, next.caret);
        } catch {
          /* tipo de input sin seleccion */
        }
      });
    },
    [targetId, onChange],
  );

  return (
    <FieldEmoji disabled={disabled} compact={compact} targetId={targetId} onPick={pick} />
  );
}

function FieldEmoji({ onPick, targetId, disabled, compact }: { onPick: (emoji: string) => void; targetId: string; disabled: boolean; compact: boolean }) {
  const focusRef = useRef<TextTarget | null>(null);
  useEffect(() => {
    focusRef.current = document.getElementById(targetId) as TextTarget | null;
  });
  return (
    <EmojiButton
      onPick={onPick}
      focusRef={focusRef}
      disabled={disabled}
      placement="bottom"
      align="end"
      className={
        compact
          ? "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-60"
          : undefined
      }
    />
  );
}
