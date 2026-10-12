"use client";

import { useState } from "react";
import { Field, inputClass } from "@/components/agents/fields";
import { CUSTOM_METRIC_RE, EOD_METRICS, isCatalogMetric } from "@/lib/eod/metrics";
import type { FormField } from "@/lib/forms/fields";

/**
 * El número de un reporte de fin de día (E2): mínimo, máximo, paso y qué mide.
 * Dos preguntas con la misma métrica en canales distintos se suman en los totales.
 */
export function EodNumberSettings({ field, disabled, onPatch }: { field: FormField; disabled: boolean; onPatch: (patch: Partial<FormField>) => void }) {
  const metric = field.metricKey;
  const isOther = metric !== undefined && !isCatalogMetric(metric);
  const [otherDraft, setOtherDraft] = useState(isOther ? metric : "");
  // "Otra…" queda elegida aunque todavía no haya una clave válida escrita.
  const [otherMode, setOtherMode] = useState(isOther);
  const otherInvalid = otherDraft !== "" && !CUSTOM_METRIC_RE.test(otherDraft);
  const intOrUndefined = (value: string) => (value === "" ? undefined : Math.trunc(Number(value)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Mínimo">
          {(id) => <input id={id} type="number" inputMode="numeric" className={inputClass} disabled={disabled} value={field.min ?? ""} onChange={(e) => onPatch({ min: intOrUndefined(e.target.value) })} />}
        </Field>
        <Field label="Máximo">
          {(id) => <input id={id} type="number" inputMode="numeric" className={inputClass} disabled={disabled} value={field.max ?? ""} onChange={(e) => onPatch({ max: intOrUndefined(e.target.value) })} />}
        </Field>
        <Field label="De a cuánto" hint="Lo que suman − y +.">
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={1}
              className={inputClass}
              disabled={disabled}
              value={field.step ?? 1}
              onChange={(e) => onPatch({ step: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
            />
          )}
        </Field>
      </div>
      <Field label="Qué mide" hint="Las preguntas que miden lo mismo se suman entre canales (por ejemplo, los links enviados en total).">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            disabled={disabled}
            value={otherMode ? "__other" : (metric ?? "")}
            onChange={(e) => {
              const value = e.target.value;
              setOtherMode(value === "__other");
              if (value === "") onPatch({ metricKey: undefined });
              else if (value === "__other") onPatch({ metricKey: CUSTOM_METRIC_RE.test(otherDraft) ? otherDraft : undefined });
              else onPatch({ metricKey: value });
            }}
          >
            <option value="">No mide nada (no suma en los totales)</option>
            {EOD_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
            <option value="__other">Otra…</option>
          </select>
        )}
      </Field>
      {otherMode && (
        <Field label="Clave de la métrica" hint="Minúsculas, números y guión bajo (de 2 a 40). Usá la misma en cada canal para que sumen.">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              disabled={disabled}
              value={otherDraft}
              aria-invalid={otherInvalid}
              onChange={(e) => {
                const value = e.target.value.trim().toLowerCase();
                setOtherDraft(value);
                if (CUSTOM_METRIC_RE.test(value)) onPatch({ metricKey: value });
              }}
            />
          )}
        </Field>
      )}
      {otherInvalid && <p className="text-xs text-destructive">La clave no es válida.</p>}
    </div>
  );
}
