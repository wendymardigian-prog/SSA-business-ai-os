"use client";

import { Plus, Trash2 } from "lucide-react";
import { CONDITION_OPERATORS, CONDITION_OPERATOR_LABELS, OPERATORS_WITHOUT_VALUE, type Condition, type ConditionTree, type Conjunction } from "@/lib/conditions/conditions-schema";
import {
  addGroup,
  addGroupCondition,
  addRootCondition,
  removeGroup,
  removeGroupCondition,
  removeRootCondition,
  setGroupConjunction,
  setRootConjunction,
  updateGroupCondition,
  updateRootCondition,
} from "@/lib/conditions/conditions-edit";
import { cn } from "@/lib/utils";

export interface EditorField {
  value: string;
  label: string;
  group: string;
  /** Lista cerrada (la taxonomía): el valor se elige en vez de escribirse. */
  options?: Array<{ value: string; label: string }>;
}

const control = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

/**
 * El constructor de condiciones: filas «campo / operador / valor», con grupos de
 * un nivel y la conjunción (Y / O) de la raíz y de cada grupo. Genérico: recibe el
 * catálogo de campos (la asignación usa el de los UTMs; la fase futura de reglas
 * de atribución usará otro). Estructura copiada de `ConditionSetEditor` de prevxcrm.
 */
export function ConditionTreeEditor({
  tree,
  onChange,
  fields,
  disabled,
}: {
  tree: ConditionTree;
  onChange: (next: ConditionTree) => void;
  fields: EditorField[];
  disabled?: boolean;
}) {
  const firstField = fields[0]?.value ?? "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Se cumple cuando se cumplen</span>
        <ConjunctionToggle value={tree.rootConjunction} onChange={(c) => onChange(setRootConjunction(tree, c))} disabled={disabled} wording={{ and: "todas", or: "alguna" }} />
      </div>

      <div className="space-y-2">
        {tree.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c}
            fields={fields}
            disabled={disabled}
            onChange={(patch) => onChange(updateRootCondition(tree, i, patch))}
            onRemove={() => onChange(removeRootCondition(tree, i))}
          />
        ))}
      </div>

      {tree.groups.map((group, gi) => (
        <div key={gi} className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2">
              <span className="font-medium">Grupo: se cumple</span>
              <ConjunctionToggle value={group.conjunction} onChange={(c) => onChange(setGroupConjunction(tree, gi, c))} disabled={disabled} wording={{ and: "todas", or: "alguna" }} />
            </span>
            <button type="button" disabled={disabled} onClick={() => onChange(removeGroup(tree, gi))} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Quitar grupo
            </button>
          </div>
          {group.conditions.map((c, ci) => (
            <ConditionRow
              key={ci}
              condition={c}
              fields={fields}
              disabled={disabled}
              onChange={(patch) => onChange(updateGroupCondition(tree, gi, ci, patch))}
              onRemove={() => onChange(removeGroupCondition(tree, gi, ci))}
            />
          ))}
          <button type="button" disabled={disabled} onClick={() => onChange(addGroupCondition(tree, gi, firstField))} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Condición en el grupo
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={disabled} onClick={() => onChange(addRootCondition(tree, firstField))} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Condición
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(addGroup(tree, firstField))} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Grupo
        </button>
      </div>
    </div>
  );
}

function ConjunctionToggle({
  value,
  onChange,
  disabled,
  wording,
}: {
  value: Conjunction;
  onChange: (c: Conjunction) => void;
  disabled?: boolean;
  wording: Record<Conjunction, string>;
}) {
  return (
    <span role="group" className="inline-flex overflow-hidden rounded-lg border border-border">
      {(["and", "or"] as const).map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn("px-2.5 py-1 text-xs font-medium", value === c ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
        >
          {wording[c]}
        </button>
      ))}
    </span>
  );
}

function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
  disabled,
}: {
  condition: Condition;
  fields: EditorField[];
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const field = fields.find((f) => f.value === condition.field);
  const needsValue = !OPERATORS_WITHOUT_VALUE.includes(condition.operator as never);
  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Campo" value={condition.field} disabled={disabled} onChange={(e) => onChange({ field: e.target.value, value: "" })} className={cn(control, "min-w-0 flex-1 sm:max-w-xs")}>
        {!field && <option value={condition.field}>{condition.field || "Elegí un campo"}</option>}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {fields.filter((f) => f.group === g).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select aria-label="Operador" value={condition.operator} disabled={disabled} onChange={(e) => onChange({ operator: e.target.value })} className={control}>
        {CONDITION_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {CONDITION_OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {needsValue &&
        (field?.options && ["is", "is_not"].includes(condition.operator) ? (
          <select aria-label="Valor" value={condition.value} disabled={disabled} onChange={(e) => onChange({ value: e.target.value })} className={cn(control, "min-w-0 flex-1 sm:max-w-[12rem]")}>
            <option value="">Elegí…</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Valor" value={condition.value} disabled={disabled} maxLength={200} onChange={(e) => onChange({ value: e.target.value })} placeholder="Valor" className={cn(control, "min-w-0 flex-1 sm:max-w-[12rem]")} />
        ))}
      <button type="button" disabled={disabled} onClick={onRemove} aria-label="Quitar la condición" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
