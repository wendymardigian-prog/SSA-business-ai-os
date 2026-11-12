"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PathConditions } from "@/components/automations/path-conditions";
import type { ConditionFieldGroup } from "@/lib/flow-engine/condition-catalog";
import {
  MAX_RULES,
  POINTS_MAX,
  POINTS_MIN,
  QUALIFY_MODES,
  QUALIFY_MODE_LABELS,
  RULE_LABEL_MAX,
  checkQualifyStep,
  newRuleId,
  type QualificationRule,
  type QualifyLeadStepData,
  type QualifyStepMode,
} from "@/lib/flow-engine/qualify-lead";

/**
 * El formulario del paso «Calificar lead» (00329). Lo comparten el editor de
 * pasos y el panel del lienzo. Las reglas usan el mismo
 * constructor de condiciones que «Condiciones», con los campos de ese punto del
 * flujo (lo que lo disparó, la reunión, el contacto…).
 */

const POINT_OPTIONS = Array.from({ length: POINTS_MAX - POINTS_MIN + 1 }, (_, i) => POINTS_MIN + i).filter((n) => n !== 0);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function QualifyLeadFields({
  idPrefix,
  data,
  patch,
  groups,
  disabled,
  inputClassName,
}: {
  idPrefix: string;
  data: Partial<QualifyLeadStepData>;
  patch: (next: Partial<QualifyLeadStepData>) => void;
  /** Los campos para las condiciones de las reglas; vacío mientras carga. */
  groups: ConditionFieldGroup[];
  disabled?: boolean;
  inputClassName: string;
}) {
  const mode = (QUALIFY_MODES as readonly string[]).includes(data.mode ?? "") ? (data.mode as QualifyStepMode) : "add";
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const problem = checkQualifyStep({ ...data, mode });

  function setMode(next: QualifyStepMode) {
    if (next === "set") return patch({ mode: next, level: typeof data.level === "number" ? data.level : 3 });
    if (next === "add") return patch({ mode: next, points: typeof data.points === "number" && data.points !== 0 ? data.points : 1 });
    if (next === "rules") {
      return patch({
        mode: next,
        base: data.base ?? "current",
        rules: rules.length ? rules : [{ id: newRuleId(), logic: "and", conditions: [], points: 1 }],
      });
    }
    patch({ mode: next });
  }

  function setRules(next: QualificationRule[]) {
    patch({ rules: next });
  }
  function patchRule(id: string, next: Partial<QualificationRule>) {
    setRules(rules.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }
  function moveRule(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to], next[index]];
    setRules(next);
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Qué hacer</span>
        <select
          id={`${idPrefix}-mode`}
          value={mode}
          disabled={disabled}
          onChange={(e) => setMode(e.target.value as QualifyStepMode)}
          className={inputClassName}
        >
          {QUALIFY_MODES.map((m) => (
            <option key={m} value={m}>
              {QUALIFY_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      {mode === "set" && (
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Nivel</span>
          <select
            value={String(data.level ?? "")}
            disabled={disabled}
            onChange={(e) => patch({ level: Number(e.target.value) })}
            className={inputClassName}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === "add" && (
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Puntos</span>
          <select
            value={String(data.points ?? 1)}
            disabled={disabled}
            onChange={(e) => patch({ points: Number(e.target.value) })}
            className={inputClassName}
          >
            {POINT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {signed(n)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Nunca pasa de 5 ni baja de 1. Si el lead no tenía calificación, sumar 1 lo deja en 1.
          </span>
        </label>
      )}

      {mode === "clear" && <p className="text-xs text-muted-foreground">El lead queda «Sin calificar».</p>}

      {mode === "rules" && (
        <div className="space-y-3">
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Contar desde</span>
            <select
              value={String(data.base ?? "current")}
              disabled={disabled}
              onChange={(e) => patch({ base: e.target.value === "current" ? "current" : Number(e.target.value) })}
              className={inputClassName}
            >
              <option value="current">El nivel que ya tiene (sin calificar cuenta como 0)</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  El nivel {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-muted-foreground">
            Se miran todas las reglas y se suman los puntos de las que se cumplen. El resultado queda entre 1 y 5.
          </p>

          <ol className="space-y-3">
            {rules.map((rule, index) => (
              <li key={rule.id} className="space-y-2 rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Regla {index + 1}</span>
                  <input
                    value={rule.label ?? ""}
                    maxLength={RULE_LABEL_MAX}
                    placeholder="Nombre (opcional)"
                    aria-label={`Nombre de la regla ${index + 1}`}
                    disabled={disabled}
                    onChange={(e) => patchRule(rule.id, { label: e.target.value })}
                    className={`${inputClassName} min-w-0 flex-1`}
                  />
                  <select
                    value={String(rule.points)}
                    aria-label={`Puntos de la regla ${index + 1}`}
                    disabled={disabled}
                    onChange={(e) => patchRule(rule.id, { points: Number(e.target.value) })}
                    className={`${inputClassName} w-20 shrink-0`}
                  >
                    {POINT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {signed(n)}
                      </option>
                    ))}
                  </select>
                </div>
                <PathConditions
                  path={{ logic: rule.logic === "or" ? "or" : "and", conditions: Array.isArray(rule.conditions) ? rule.conditions : [] }}
                  groups={groups}
                  disabled={disabled}
                  onChange={(next) => patchRule(rule.id, next)}
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    aria-label={`Subir la regla ${index + 1}`}
                    disabled={disabled || index === 0}
                    onClick={() => moveRule(index, -1)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Bajar la regla ${index + 1}`}
                    disabled={disabled || index === rules.length - 1}
                    onClick={() => moveRule(index, 1)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Borrar la regla ${index + 1}`}
                    disabled={disabled || rules.length === 1}
                    onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={disabled || rules.length >= MAX_RULES}
            onClick={() =>
              setRules([...rules, { id: newRuleId(rules.map((r) => r.id)), logic: "and", conditions: [], points: 1 }])
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Regla
          </button>
        </div>
      )}

      {problem && <p className="text-[11px] text-amber-700 dark:text-amber-300">{problem}</p>}
    </div>
  );
}
