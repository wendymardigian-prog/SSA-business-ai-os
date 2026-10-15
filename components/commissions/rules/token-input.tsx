"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { addTokens } from "@/lib/commissions/rules-ui-draft";
import { cn } from "@/lib/utils";
import { FOCUS } from "./ui";

/**
 * Valores sueltos escritos a mano: se agregan con Enter o con coma, o al salir del campo, y se quitan con un clic.
 * Debajo, los que más se usaron (para elegir sin tipear). Lo hace con el teclado igual que con el mouse.
 */
export function TokenInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  max,
  maxLength,
  pattern,
  invalidHint,
  suggestions,
  suggestionsTitle,
  labelOf,
  describedBy,
  invalid,
}: {
  id: string;
  /** Para el lector de pantalla (el texto visible lo pone quien lo usa). */
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  pattern?: RegExp;
  /** Qué decir cuando un valor no entra por su forma. */
  invalidHint?: string;
  suggestions?: readonly string[];
  suggestionsTitle?: string;
  labelOf?: (value: string) => string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function commit(raw: string) {
    if (!raw.trim()) return;
    const result = addTokens(values, raw, { max, maxLength, pattern });
    if (result.values.length !== values.length) onChange(result.values);
    setText("");
    setNote(result.rejected.length > 0 ? (invalidHint ?? `No pude agregar: ${result.rejected.join(", ")}`) : null);
  }

  const pickable = (suggestions ?? []).filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className="space-y-1.5">
      <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1", invalid ? "border-red-500/70" : "border-border")}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(values.filter((v) => v !== value))}
            aria-label={`Quitar ${label.toLowerCase()}: ${labelOf ? labelOf(value) : value}`}
            className={cn("inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs hover:bg-accent", FOCUS)}
          >
            <span className="truncate">{labelOf ? labelOf(value) : value}</span>
            <X className="h-3 w-3 shrink-0" aria-hidden />
          </button>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            if (next.includes(",")) commit(next);
            else setText(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && text === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => commit(text)}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          autoComplete="off"
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      {note && <p role="alert" className="text-[11px] text-amber-800 dark:text-amber-300">{note}</p>}
      {suggestions !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pickable.length > 0 ? (
            <>
              <span className="text-[11px] text-muted-foreground">{suggestionsTitle ?? "Usados en los últimos 90 días:"}</span>
              {pickable.slice(0, 12).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange(addTokens(values, s, { max, maxLength, pattern }).values)}
                  className={cn("inline-flex h-6 max-w-[12rem] items-center rounded-full border border-dashed border-border px-2 text-[11px] hover:bg-accent", FOCUS)}
                  aria-label={`Agregar ${label.toLowerCase()}: ${s}`}
                >
                  <span className="truncate">+ {s}</span>
                </button>
              ))}
            </>
          ) : suggestions.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">Todavía no hay valores de los últimos 90 días: escribilos a mano.</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

