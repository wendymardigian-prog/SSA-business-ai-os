"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONDITION_FIELDS,
  findConditionField,
  joinConditionField,
  splitConditionField,
} from "@/lib/flow-engine/condition-fields";
import { listSequenceOptions } from "@/lib/actions/sequences";

interface Condition {
  field: string;
  operator: string;
  value: string;
}

interface ConditionPanelData {
  conditions?: Condition[];
  logic?: "and" | "or";
  [key: string]: unknown;
}

interface ConditionPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const operatorOptions = [
  { value: "equals", label: "es igual a" },
  { value: "not_equals", label: "no es igual a" },
  { value: "contains", label: "contiene" },
  { value: "exists", label: "tiene algún valor" },
  { value: "gt", label: "es mayor que" },
  { value: "lt", label: "es menor que" },
];

/**
 * Configuración del nodo Condition.
 *
 * El panel guardaba `field: "tag"` y el motor busca `"tag:<nombre del tag>"`.
 * Nunca coincidían, así que ninguna condición armada acá resolvía. Ahora el
 * catálogo de campos es compartido (lib/flow-engine/condition-fields.ts) y el
 * panel pide el argumento que faltaba: qué tag, qué variable, qué secuencia.
 */
export function ConditionPanel({ data: rawData, onChange }: ConditionPanelProps) {
  const data = rawData as ConditionPanelData;
  const conditions = data.conditions || [];
  const logic = data.logic || "and";

  const [sequences, setSequences] = useState<Array<{ id: string; name: string }>>([]);

  // Solo se piden si alguna condición las necesita.
  const needsSequences = conditions.some((c) =>
    splitConditionField(c.field).prefix.startsWith("sequence")
  );

  useEffect(() => {
    if (!needsSequences || sequences.length > 0) return;
    let alive = true;
    listSequenceOptions().then((rows) => {
      if (alive) setSequences(rows);
    });
    return () => {
      alive = false;
    };
  }, [needsSequences, sequences.length]);

  const addCondition = useCallback(() => {
    onChange({
      ...data,
      conditions: [...conditions, { field: "tag:", operator: "equals", value: "true" }],
    });
  }, [data, conditions, onChange]);

  const updateCondition = useCallback(
    (index: number, updated: Condition) => {
      const next = [...conditions];
      next[index] = updated;
      onChange({ ...data, conditions: next });
    },
    [data, conditions, onChange]
  );

  const removeCondition = useCallback(
    (index: number) => {
      onChange({ ...data, conditions: conditions.filter((_, i) => i !== index) });
    },
    [data, conditions, onChange]
  );

  const toggleLogic = useCallback(() => {
    onChange({ ...data, logic: logic === "and" ? "or" : "and" });
  }, [data, logic, onChange]);

  return (
    <div className="space-y-4">
      {conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Se cumplen</span>
          <button
            type="button"
            onClick={toggleLogic}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              logic === "and" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
            )}
          >
            {logic === "and" ? "TODAS" : "ALGUNA"}
          </button>
          <span className="text-xs text-muted-foreground">las condiciones</span>
        </div>
      )}

      <div className="space-y-3">
        {conditions.map((condition, index) => {
          const { prefix, argument } = splitConditionField(condition.field);
          const option = findConditionField(prefix) ?? CONDITION_FIELDS[0];

          function setField(nextPrefix: string) {
            // Al cambiar de campo el argumento viejo no sirve: un nombre de tag
            // no es un id de secuencia.
            const next = findConditionField(nextPrefix);
            updateCondition(index, {
              ...condition,
              field: joinConditionField(nextPrefix, ""),
              value: next?.valueKind === "boolean" ? "true" : condition.value,
            });
          }

          function setArgument(nextArgument: string) {
            updateCondition(index, {
              ...condition,
              field: joinConditionField(prefix, nextArgument),
            });
          }

          return (
            <div key={index}>
              {index > 0 && (
                <div className="my-2 flex items-center justify-center">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      logic === "and" ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                    )}
                  >
                    {logic === "and" ? "y" : "o"}
                  </span>
                </div>
              )}

              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Condición {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCondition(index)}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                    aria-label={`Quitar la condición ${index + 1}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-2">
                  <label htmlFor={`cond-${index}-field`} className="sr-only">
                    Campo de la condición {index + 1}
                  </label>
                  <select
                    id={`cond-${index}-field`}
                    value={prefix}
                    onChange={(e) => setField(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.prefix || "custom"} value={f.prefix}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  {option.argument === "text" && (
                    <>
                      <label htmlFor={`cond-${index}-arg`} className="sr-only">
                        {option.argumentLabel}
                      </label>
                      <input
                        id={`cond-${index}-arg`}
                        type="text"
                        value={argument}
                        onChange={(e) => setArgument(e.target.value)}
                        placeholder={option.argumentPlaceholder}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </>
                  )}

                  {option.argument === "sequence" && (
                    <>
                      <label htmlFor={`cond-${index}-seq`} className="sr-only">
                        Secuencia
                      </label>
                      <select
                        id={`cond-${index}-seq`}
                        value={argument}
                        onChange={(e) => setArgument(e.target.value)}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="">Elegí una secuencia</option>
                        {sequences.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  <label htmlFor={`cond-${index}-op`} className="sr-only">
                    Operador
                  </label>
                  <select
                    id={`cond-${index}-op`}
                    value={condition.operator}
                    onChange={(e) =>
                      updateCondition(index, { ...condition, operator: e.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {operatorOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  {condition.operator !== "exists" && (
                    <>
                      <label htmlFor={`cond-${index}-value`} className="sr-only">
                        Valor
                      </label>
                      {option.valueKind === "boolean" ? (
                        <select
                          id={`cond-${index}-value`}
                          value={condition.value || "true"}
                          onChange={(e) =>
                            updateCondition(index, { ...condition, value: e.target.value })
                          }
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          id={`cond-${index}-value`}
                          type="text"
                          value={condition.value}
                          onChange={(e) =>
                            updateCondition(index, { ...condition, value: e.target.value })
                          }
                          placeholder="Valor"
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      )}
                    </>
                  )}

                  {option.hint && (
                    <p className="text-[11px] text-muted-foreground">{option.hint}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCondition}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-amber-400 hover:text-amber-500"
      >
        <Plus className="h-4 w-4" />
        Agregar condición
      </button>

      {conditions.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Las condiciones parten el flow en dos. Quien las cumple sigue por la salida
          &ldquo;Sí&rdquo;; el resto, por la de &ldquo;No&rdquo;.
        </p>
      )}
    </div>
  );
}
