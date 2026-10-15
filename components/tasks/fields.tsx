"use client";

import { CalendarDays, Timer, X } from "lucide-react";
import { formatDayLong } from "@/lib/tasks/format";
import { formatDuration } from "@/lib/tasks/time";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Los campos del drawer. Cada uno guarda SOLO, sin boton de «guardar»: al salir del campo (blur), con Enter
 * en los de una linea y tambien si el drawer se cierra con el campo a medio escribir (nunca se pierde lo
 * escrito). Esc vuelve al valor guardado.
 */

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function AutoSaveText({
  value,
  onSave,
  label,
  placeholder,
  maxLength,
  multiline = false,
  disabled = false,
  className,
  rows = 4,
  required = false,
  autoFocus = false,
}: {
  value: string;
  /** Recibe el texto ya recortado. Devuelve/ignora una promesa. */
  onSave: (next: string) => void | Promise<unknown>;
  label: string;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  rows?: number;
  /** Un campo obligatorio (el titulo) nunca se guarda vacio: vuelve al valor anterior. */
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value);
  // Si el valor guardado cambia desde afuera (otra pestaña, el servidor), el campo lo toma, salvo que se este escribiendo.
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setText(value);
  }

  const textRef = useLatest(text);
  const valueRef = useLatest(value);
  const saveRef = useLatest(onSave);
  const requiredRef = useLatest(required);

  const flush = () => {
    const next = textRef.current.trim();
    if (next === valueRef.current.trim()) return;
    if (requiredRef.current && next === "") {
      setText(valueRef.current);
      return;
    }
    void saveRef.current(next);
  };

  // Cerrar el drawer con el campo a medias guarda lo escrito.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const common = {
    value: text,
    maxLength,
    disabled,
    placeholder,
    autoFocus,
    "aria-label": label,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      flush();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
  };

  const base = "w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition-colors hover:border-input focus:border-primary focus:bg-background disabled:cursor-default disabled:hover:border-transparent";

  if (multiline) {
    return (
      <div>
        <textarea
          {...common}
          rows={rows}
          onKeyDown={(e) => {
            if (e.key === "Escape" && text !== value) {
              e.preventDefault();
              e.stopPropagation();
              setText(value);
            }
          }}
          className={cn(base, "resize-y", className)}
        />
        {text.length > maxLength * 0.9 && <p className="px-2 text-right text-xs text-muted-foreground">{text.length} / {maxLength}</p>}
      </div>
    );
  }

  return (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape" && text !== value) {
          e.preventDefault();
          e.stopPropagation();
          setText(value);
        }
      }}
      className={cn(base, className)}
    />
  );
}

/**
 * La fecha de la tarea (AAAA-MM-DD), como una pastilla. Todo el campo es el boton: hacer clic en cualquier parte
 * abre el calendario (no hace falta apuntarle al iconito). Por abajo hay un `<input type="date">` transparente
 * que cubre la pastilla; elegir un dia lo guarda al instante. Sin fecha, la pastilla dice «Fecha».
 */
export function DatePill({
  value,
  onSave,
  label,
  today,
  disabled,
  overdue = false,
}: {
  value: string | null;
  onSave: (next: string | null) => void | Promise<unknown>;
  label: string;
  /** AAAA-MM-DD de hoy en la zona del workspace: decide si el texto lleva el año. */
  today: string;
  disabled?: boolean;
  /** La fecha ya paso y la tarea sigue abierta: el texto va en rojo. */
  overdue?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openCalendar = () => {
    try {
      inputRef.current?.showPicker();
    } catch {
      // Un navegador sin showPicker, o uno que ya tiene el calendario abierto: el campo sigue siendo escribible.
    }
  };
  const text = value ? formatDayLong(value, today) : "Fecha";

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[13px] transition-colors focus-within:border-primary",
          !disabled && "hover:border-muted-foreground/60",
          disabled && "opacity-80",
          !value && "text-muted-foreground",
          overdue && "text-red-600 dark:text-red-400",
        )}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">{text}</span>
        <input
          ref={inputRef}
          type="date"
          value={value ?? ""}
          disabled={disabled}
          aria-label={label}
          onClick={openCalendar}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openCalendar();
            }
          }}
          onChange={(e) => void onSave(e.target.value || null)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </span>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => void onSave(null)}
          aria-label="Quitar la fecha"
          title="Quitar la fecha"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** La duracion, como una pastilla con un reloj: de 15 minutos a 8 horas, o vacia (se dibuja de 30 minutos). Un valor que ya estaba se conserva. */
export function DurationSelect({
  value,
  onChange,
  label,
  disabled,
  options,
  title,
}: {
  value: number | null;
  onChange: (next: number | null) => void | Promise<unknown>;
  label: string;
  disabled?: boolean;
  options: readonly number[];
  /** Un texto de ayuda al pasar el mouse (por ejemplo, por que esta apagada). */
  title?: string;
}) {
  const list = value !== null && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options;
  return (
    <span title={title} className={cn("relative inline-flex h-8 items-center rounded-lg border border-input bg-background text-[13px] transition-colors focus-within:border-primary", !disabled && "hover:border-muted-foreground/60", disabled && "opacity-60")}>
      <Timer className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <select
        value={value === null ? "" : String(value)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => void onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cn("h-full cursor-pointer appearance-none rounded-lg bg-transparent pl-8 pr-3 outline-none disabled:cursor-default", value === null && "text-muted-foreground")}
      >
        <option value="">Duración</option>
        {list.map((m) => (
          <option key={m} value={m}>{formatDuration(m)}</option>
        ))}
      </select>
    </span>
  );
}

export function Section({ title, children, action, innerRef }: { title: string; children: ReactNode; action?: ReactNode; innerRef?: RefObject<HTMLElement | null> }) {
  return (
    <section ref={innerRef} className="border-b border-border px-4 py-4 last:border-b-0" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
