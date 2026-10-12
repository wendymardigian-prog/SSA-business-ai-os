"use client";

import { useId } from "react";
import { NumberStepper } from "@/components/eod/number-stepper";
import { decrement, increment } from "@/lib/eod/stepper";
import { getDraftValue, setDraftValue, type DraftValue, type EodDraftData } from "@/lib/eod/draft";
import type { FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";

/**
 * Una pregunta del reporte de fin de día. `channel` null = pregunta general. Los cambios se
 * aplican con `update` sobre el borrador MÁS NUEVO (ver `useEodDraft`).
 */
export function EodQuestion({
  field,
  channel,
  data,
  update,
  disabled,
  error,
}: {
  field: FormField;
  channel: string | null;
  data: EodDraftData;
  update: (mutate: (draft: EodDraftData) => EodDraftData) => void;
  disabled: boolean;
  error?: string | null;
}) {
  const id = useId();
  const value = getDraftValue(data, channel, field.key);
  const set = (next: DraftValue | undefined) => update((d) => setDraftValue(d, channel, field.key, next));

  if (field.type === "number") {
    const bounds = { min: field.min, max: field.max, step: field.step };
    const current = typeof value === "number" ? value : null;
    return (
      <NumberStepper
        label={field.label}
        help={field.help}
        required={field.required}
        value={current}
        bounds={bounds}
        disabled={disabled}
        error={error}
        onIncrement={() =>
          update((d) => {
            const v = getDraftValue(d, channel, field.key);
            return setDraftValue(d, channel, field.key, increment(typeof v === "number" ? v : null, bounds));
          })
        }
        onDecrement={() =>
          update((d) => {
            const v = getDraftValue(d, channel, field.key);
            return setDraftValue(d, channel, field.key, decrement(typeof v === "number" ? v : null, bounds));
          })
        }
        onSet={(n) => set(n)}
      />
    );
  }

  const labelEl = (
    <span className="block text-sm font-medium">
      {field.label}
      {field.required && (
        <span className="text-destructive" aria-hidden>
          {" "}
          *
        </span>
      )}
    </span>
  );
  const help = field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null;
  const err = error ? (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  ) : null;
  const inputClass = cn(
    "w-full rounded-xl border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60",
    error ? "border-destructive" : "border-input",
  );

  if (field.type === "short_text" || field.type === "long_text") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id}>{labelEl}</label>
        {help}
        {field.type === "long_text" ? (
          <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={5000} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />
        ) : (
          <input id={id} className={inputClass} disabled={disabled} maxLength={500} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />
        )}
        {err}
      </div>
    );
  }

  if (field.type === "single_select" || field.type === "multi_select") {
    const multi = field.type === "multi_select";
    const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === "string" ? value : null;
    return (
      <fieldset className="space-y-1.5">
        <legend>{labelEl}</legend>
        {help}
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((option) => {
            const on = multi ? (selected as string[]).includes(option) : selected === option;
            return (
              <label
                key={option}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                  on ? "border-primary bg-primary/10" : "border-border",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={`${id}-opt`}
                  className="h-4 w-4"
                  disabled={disabled}
                  checked={on}
                  onChange={(e) => {
                    if (!multi) return set(option);
                    const list = selected as string[];
                    set(e.target.checked ? [...list, option] : list.filter((o) => o !== option));
                  }}
                />
                {option}
              </label>
            );
          })}
        </div>
        {err}
      </fieldset>
    );
  }

  return null;
}
