"use client";

import { formatDuration } from "@/lib/tasks/time";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** Una fecha (AAAA-MM-DD). Se guarda al salir del campo; vacia = sin fecha. */
export function DateField({
  value,
  onSave,
  label,
  disabled,
  min,
  max,
}: {
  value: string | null;
  onSave: (next: string | null) => void | Promise<unknown>;
  label: string;
  disabled?: boolean;
  min?: string | null;
  max?: string | null;
}) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setText(value ?? "");
  }

  const textRef = useLatest(text);
  const valueRef = useLatest(value);
  const saveRef = useLatest(onSave);
  const flush = () => {
    const next = textRef.current || null;
    if (next === valueRef.current) return;
    void saveRef.current(next);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      type="date"
      value={text}
      disabled={disabled}
      min={min ?? undefined}
      max={max ?? undefined}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        flush();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape" && text !== (value ?? "")) {
          e.preventDefault();
          e.stopPropagation();
          setText(value ?? "");
        }
      }}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary disabled:cursor-default disabled:opacity-80"
    />
  );
}

/** Una hora (HH:MM). Se guarda al salir del campo; vacia = sin hora. «Quitar hora» la borra de un clic. */
export function TimeField({
  value,
  onSave,
  label,
  disabled,
}: {
  value: string | null;
  onSave: (next: string | null) => void | Promise<unknown>;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setText(value ?? "");
  }

  const textRef = useLatest(text);
  const valueRef = useLatest(value);
  const saveRef = useLatest(onSave);
  const flush = () => {
    const next = textRef.current || null;
    if (next === valueRef.current) return;
    void saveRef.current(next);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={text}
        disabled={disabled}
        aria-label={label}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          flush();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape" && text !== (value ?? "")) {
            e.preventDefault();
            e.stopPropagation();
            setText(value ?? "");
          }
        }}
        className="h-8 w-36 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary disabled:cursor-default disabled:opacity-60"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => {
            setText("");
            void onSave(null);
          }}
          className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Quitar hora
        </button>
      )}
    </div>
  );
}

/** La duracion: 15, 30, 45, 60, 90 o 120 minutos, o vacia (se dibuja de 30 minutos). Un valor que ya estaba se conserva. */
export function DurationSelect({
  value,
  onChange,
  label,
  disabled,
  options,
}: {
  value: number | null;
  onChange: (next: number | null) => void | Promise<unknown>;
  label: string;
  disabled?: boolean;
  options: readonly number[];
}) {
  const list = value !== null && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options;
  return (
    <select
      value={value === null ? "" : String(value)}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => void onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-8 w-48 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary disabled:cursor-default disabled:opacity-60"
    >
      <option value="">Sin duración (30 min)</option>
      {list.map((m) => (
        <option key={m} value={m}>{formatDuration(m)}</option>
      ))}
    </select>
  );
}

/** Una fila «etiqueta + valor» del drawer. */
export function FieldRow({ label, children, htmlFor, top = false }: { label: string; children: ReactNode; htmlFor?: string; top?: boolean }) {
  return (
    <div className={cn("grid gap-1 sm:grid-cols-[130px_1fr] sm:gap-3", top ? "sm:items-start" : "sm:items-center")}>
      <label htmlFor={htmlFor} className={cn("text-xs font-medium text-muted-foreground", top && "sm:pt-2")}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
