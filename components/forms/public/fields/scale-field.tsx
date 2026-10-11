"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldShell, type FieldProps } from "./shared";

/** Estrellas de 1 a 5. */
export function RatingField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const current = typeof value === "number" ? value : Number(value) || 0;
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <div id={id} role="radiogroup" aria-label={field.label} aria-describedby={describedBy} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
              disabled={locked}
              onFocus={onInteract}
              onClick={() => onChange(n)}
              className="rounded p-1 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
            >
              <Star className={cn("h-7 w-7", n <= current ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </FieldShell>
  );
}

/** NPS de 0 a 10: dos filas en el celular (0-5 y 6-10), una sola en pantallas grandes. */
export function NpsField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const current = typeof value === "number" ? value : value === "" || value === null || value === undefined ? null : Number(value);
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <div>
          <div id={id} role="radiogroup" aria-label={field.label} aria-describedby={describedBy} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={current === n}
                disabled={locked}
                onFocus={onInteract}
                onClick={() => onChange(n)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70",
                  current === n ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Nada probable</span>
            <span>Muy probable</span>
          </div>
        </div>
      )}
    </FieldShell>
  );
}
