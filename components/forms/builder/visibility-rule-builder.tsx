"use client";

import { Plus, Trash2 } from "lucide-react";
import { inputClass } from "@/components/agents/fields";
import type { FormFieldType } from "@/lib/forms/fields";
import { defaultOperatorFor, isOperatorValidFor, needsValue, operatorsFor, valueInputFor } from "@/lib/forms/visibility-ui";
import type { Condition, ConditionGroup, ConditionOperator, VisibilityConfig } from "@/lib/forms/visibility-types";

/**
 * El constructor de condiciones (F5). Se escribe UNA vez y lo usan el campo y,
 * más adelante, el panel de triggers de automatizaciones.
 *
 * Aspecto de `VisibilityRuleBuilder.tsx` de prevxcrm: reglas sueltas más grupos
 * con su propio "y / o". Una condición solo puede mirar campos anteriores
 * (`sources` ya viene filtrado).
 */

export interface ConditionSource {
  key: string;
  label: string;
  type: FormFieldType;
  options?: string[];
}

const EMPTY: VisibilityConfig = { rootConjunction: "and", conditions: [], groups: [] };

function newId(): string {
  return `c_${Math.random().toString(36).slice(2, 9)}`;
}

function blankCondition(source: ConditionSource | undefined): Condition {
  return {
    id: newId(),
    fieldKey: source?.key ?? "",
    operator: source ? defaultOperatorFor(source.type) : "is",
    value: "",
  };
}

export function VisibilityRuleBuilder({
  value,
  onChange,
  sources,
  emptyHint = "Sin condiciones: el campo se muestra siempre.",
}: {
  value: VisibilityConfig | undefined;
  onChange: (next: VisibilityConfig | undefined) => void;
  sources: ConditionSource[];
  emptyHint?: string;
}) {
  const config = value ?? EMPTY;
  const total = config.conditions.length + config.groups.reduce((n, g) => n + g.conditions.length, 0);

  function commit(next: VisibilityConfig) {
    const empty = next.conditions.length === 0 && next.groups.every((g) => g.conditions.length === 0);
    onChange(empty ? undefined : { ...next, groups: next.groups.filter((g) => g.conditions.length > 0) });
  }

  if (sources.length === 0) {
    return <p className="text-xs text-muted-foreground">Para usar condiciones tiene que haber campos antes que este.</p>;
  }

  return (
    <div className="space-y-3">
      {total === 0 && <p className="text-xs text-muted-foreground">{emptyHint}</p>}

      {total > 1 && (
        <label className="flex items-center gap-2 text-xs">
          Mostrar si
          <select
            aria-label="Cómo se combinan las condiciones"
            className={`${inputClass} !w-auto !py-1`}
            value={config.rootConjunction}
            onChange={(e) => commit({ ...config, rootConjunction: e.target.value as "and" | "or" })}
          >
            <option value="and">se cumplen todas</option>
            <option value="or">se cumple alguna</option>
          </select>
        </label>
      )}

      {config.conditions.map((condition, index) => (
        <ConditionRow
          key={condition.id ?? index}
          condition={condition}
          sources={sources}
          onChange={(next) => commit({ ...config, conditions: config.conditions.map((c, i) => (i === index ? next : c)) })}
          onRemove={() => commit({ ...config, conditions: config.conditions.filter((_, i) => i !== index) })}
        />
      ))}

      {config.groups.map((group, gi) => (
        <GroupBox
          key={group.id ?? gi}
          group={group}
          sources={sources}
          onChange={(next) => commit({ ...config, groups: config.groups.map((g, i) => (i === gi ? next : g)) })}
          onRemove={() => commit({ ...config, groups: config.groups.filter((_, i) => i !== gi) })}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => commit({ ...config, conditions: [...config.conditions, blankCondition(sources[0])] })}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar condición
        </button>
        <button
          type="button"
          onClick={() => commit({ ...config, groups: [...config.groups, { id: newId(), conjunction: "or", conditions: [blankCondition(sources[0])] }] })}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar grupo
        </button>
      </div>
    </div>
  );
}

function GroupBox({
  group,
  sources,
  onChange,
  onRemove,
}: {
  group: ConditionGroup;
  sources: ConditionSource[];
  onChange: (next: ConditionGroup) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          Grupo: cumple
          <select
            aria-label="Cómo se combina el grupo"
            className={`${inputClass} !w-auto !py-1`}
            value={group.conjunction}
            onChange={(e) => onChange({ ...group, conjunction: e.target.value as "and" | "or" })}
          >
            <option value="or">alguna</option>
            <option value="and">todas</option>
          </select>
        </label>
        <button type="button" onClick={onRemove} aria-label="Quitar el grupo" className="rounded p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {group.conditions.map((condition, index) => (
        <ConditionRow
          key={condition.id ?? index}
          condition={condition}
          sources={sources}
          onChange={(next) => onChange({ ...group, conditions: group.conditions.map((c, i) => (i === index ? next : c)) })}
          onRemove={() => onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) })}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...group, conditions: [...group.conditions, blankCondition(sources[0])] })}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar al grupo
      </button>
    </div>
  );
}

function ConditionRow({
  condition,
  sources,
  onChange,
  onRemove,
}: {
  condition: Condition;
  sources: ConditionSource[];
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  const source = sources.find((s) => s.key === condition.fieldKey);
  const type = source?.type ?? "short_text";
  const input = valueInputFor(type, condition.operator);

  function setField(key: string) {
    const next = sources.find((s) => s.key === key);
    if (!next) return;
    onChange({
      ...condition,
      fieldKey: key,
      operator: isOperatorValidFor(next.type, condition.operator) ? condition.operator : defaultOperatorFor(next.type),
      value: "",
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Campo" className={`${inputClass} !w-auto min-w-[8rem] flex-1 !py-1`} value={condition.fieldKey} onChange={(e) => setField(e.target.value)}>
        {!source && <option value="">Elegí un campo</option>}
        {sources.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Operador"
        className={`${inputClass} !w-auto !py-1`}
        value={condition.operator}
        onChange={(e) => {
          const operator = e.target.value as ConditionOperator;
          onChange({ ...condition, operator, value: needsValue(operator) ? condition.value : "" });
        }}
      >
        {operatorsFor(type).map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {input === "options" && (
        <select aria-label="Valor" className={`${inputClass} !w-auto min-w-[8rem] flex-1 !py-1`} value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">Elegí una opción</option>
          {(source?.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
      {input === "boolean" && (
        <select aria-label="Valor" className={`${inputClass} !w-auto !py-1`} value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">Elegí</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      )}
      {(input === "text" || input === "number" || input === "date") && (
        <input
          aria-label="Valor"
          type={input === "number" ? "number" : input === "date" ? "date" : "text"}
          className={`${inputClass} !w-auto min-w-[7rem] flex-1 !py-1`}
          value={condition.value}
          placeholder={condition.operator === "includes_any" ? "a, b, c" : undefined}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      )}

      <button type="button" onClick={onRemove} aria-label="Quitar la condición" className="rounded p-1 text-muted-foreground hover:text-destructive">
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
