"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { inputClass } from "@/components/agents/fields";
import type { FieldOption } from "@/lib/flow-engine/condition-eval";
import {
  argumentOf,
  blankCondition,
  changeField,
  changeOperator,
  conditionProblem,
  countConditions,
  describeBuilderCondition,
  fieldOfCondition,
  isLegacyCondition,
  newConditionId,
  operatorsOf,
  optionsWithCurrent,
  pruneGroups,
  setArgument,
  slotsOf,
  type BuilderCondition,
  type BuilderField,
  type BuilderGroup,
  type BuilderValue,
  type ValueSlot,
} from "@/lib/automations/condition-builder-model";

/**
 * El constructor de condiciones, generalizado (sale de `VisibilityRuleBuilder`).
 *
 * Recibe los campos que se pueden comparar, con su tipo y sus opciones, y de ahi
 * saca los operadores y lo que hay que pedir de cada uno (todo eso decidido en
 * `lib/automations/condition-builder-model.ts`; esto solo lo dibuja). Una
 * seleccion siempre se elige de un desplegable con sus opciones: nunca se escribe.
 *
 * Lo usan tres cosas: los caminos de "Condiciones" (canvas y editor de pasos),
 * la visibilidad de un campo de formulario y el "Solo si…" del disparador. Las
 * dos ultimas pasan por el envoltorio `VisibilityRuleBuilder`, que traduce a su
 * formato guardado (que no cambia).
 */

export interface ConditionBuilderProps {
  value: BuilderValue;
  onChange: (next: BuilderValue) => void;
  /** Los campos que se ofrecen para armar condiciones nuevas. */
  fields: BuilderField[];
  /** Todos los que se reconocen al leer (incluye los viejos). Por defecto, `fields`. */
  recognized?: BuilderField[];
  /** Las secuencias, para los campos cuyo argumento es una secuencia. */
  sequenceOptions?: FieldOption[];
  /** Con grupos ("y / o" anidado) o solo reglas sueltas. */
  allowGroups?: boolean;
  /** "Mostrar si" / "Se cumple": el texto que va antes de "todas / alguna". */
  leadLabel?: string;
  emptyHint?: string;
  /** Un aviso por condicion (por ejemplo "Esta pregunta ya no existe en el formulario."). */
  staleFor?: (condition: BuilderCondition) => string | null;
  disabled?: boolean;
}

const selectClass = `${inputClass} !w-auto !py-1`;

export function ConditionBuilder({
  value,
  onChange,
  fields,
  recognized,
  sequenceOptions = [],
  allowGroups = true,
  leadLabel = "Se cumple",
  emptyHint = "Sin condiciones.",
  staleFor,
  disabled = false,
}: ConditionBuilderProps) {
  const total = countConditions(value);
  const known = recognized ?? fields;

  function commit(next: BuilderValue) {
    onChange(allowGroups ? pruneGroups(next) : next);
  }

  if (fields.length === 0 && total === 0) {
    return <p className="text-xs text-muted-foreground">Para usar condiciones tiene que haber campos para comparar.</p>;
  }

  const shared = { fields, known, sequenceOptions, staleFor, disabled };

  return (
    <div className="space-y-3">
      {total === 0 && <p className="text-xs text-muted-foreground">{emptyHint}</p>}

      {total > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-xs">
          {leadLabel}
          <select
            aria-label="Cómo se combinan las condiciones"
            className={selectClass}
            disabled={disabled}
            value={value.rootConjunction}
            onChange={(e) => commit({ ...value, rootConjunction: e.target.value as "and" | "or" })}
          >
            <option value="and">se cumplen todas</option>
            <option value="or">se cumple alguna</option>
          </select>
        </label>
      )}

      {value.conditions.map((condition, index) => (
        <ConditionRow
          key={condition.id ?? index}
          condition={condition}
          {...shared}
          onChange={(next) => commit({ ...value, conditions: value.conditions.map((c, i) => (i === index ? next : c)) })}
          onRemove={() => commit({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })}
        />
      ))}

      {allowGroups &&
        value.groups.map((group, gi) => (
          <GroupBox
            key={group.id ?? gi}
            group={group}
            {...shared}
            onChange={(next) => commit({ ...value, groups: value.groups.map((g, i) => (i === gi ? next : g)) })}
            onRemove={() => commit({ ...value, groups: value.groups.filter((_, i) => i !== gi) })}
          />
        ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || fields.length === 0}
          onClick={() => commit({ ...value, conditions: [...value.conditions, blankCondition(fields[0])] })}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar condición
        </button>
        {allowGroups && (
          <button
            type="button"
            disabled={disabled || fields.length === 0}
            onClick={() => commit({ ...value, groups: [...value.groups, { id: newConditionId(), conjunction: "or", conditions: [blankCondition(fields[0])] }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar grupo
          </button>
        )}
      </div>
    </div>
  );
}

interface SharedRowProps {
  fields: BuilderField[];
  known: BuilderField[];
  sequenceOptions: FieldOption[];
  staleFor?: (condition: BuilderCondition) => string | null;
  disabled: boolean;
}

function GroupBox({
  group,
  onChange,
  onRemove,
  ...shared
}: SharedRowProps & {
  group: BuilderGroup;
  onChange: (next: BuilderGroup) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          Grupo: cumple
          <select
            aria-label="Cómo se combina el grupo"
            className={selectClass}
            disabled={shared.disabled}
            value={group.conjunction}
            onChange={(e) => onChange({ ...group, conjunction: e.target.value as "and" | "or" })}
          >
            <option value="or">alguna</option>
            <option value="and">todas</option>
          </select>
        </label>
        <button type="button" disabled={shared.disabled} onClick={onRemove} aria-label="Quitar el grupo" className="rounded p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {group.conditions.map((condition, index) => (
        <ConditionRow
          key={condition.id ?? index}
          condition={condition}
          {...shared}
          onChange={(next) => onChange({ ...group, conditions: group.conditions.map((c, i) => (i === index ? next : c)) })}
          onRemove={() => onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) })}
        />
      ))}
      <button
        type="button"
        disabled={shared.disabled || shared.fields.length === 0}
        onClick={() => onChange({ ...group, conditions: [...group.conditions, blankCondition(shared.fields[0])] })}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar al grupo
      </button>
    </div>
  );
}

function ConditionRow({
  condition,
  fields,
  known,
  sequenceOptions,
  staleFor,
  disabled,
  onChange,
  onRemove,
}: SharedRowProps & {
  condition: BuilderCondition;
  onChange: (next: BuilderCondition) => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const field = fieldOfCondition(known, condition.field);
  const stale = staleFor?.(condition) ?? null;

  // Una condicion del nodo viejo: se lee como frase. Se cambia quitandola y armando una nueva.
  if (isLegacyCondition(condition)) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
        <span className="flex-1">
          {describeBuilderCondition(condition, known)}
          <span className="ml-1 text-muted-foreground">(formato anterior: para cambiarla, quitala y armá una nueva)</span>
        </span>
        <button type="button" disabled={disabled} onClick={onRemove} aria-label="Quitar la condición" className="rounded p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  const problem = stale ?? conditionProblem(condition, field);
  const operators = field ? operatorsOf(field) : [];
  const slots = field ? slotsOf(field, condition.operator) : [];
  const groupsOfFields = groupFields(fields, field);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Campo"
          disabled={disabled}
          className={`${inputClass} !w-auto min-w-[8rem] flex-1 !py-1`}
          value={field ? field.path : condition.field}
          onChange={(e) => {
            const next = fields.find((f) => f.path === e.target.value) ?? known.find((f) => f.path === e.target.value);
            if (next) onChange(changeField(condition, next));
          }}
        >
          {!field && <option value={condition.field}>{condition.field === "" ? "Elegí un campo" : `${condition.field} (ya no existe)`}</option>}
          {groupsOfFields.map(({ label, items }) =>
            label ? (
              <optgroup key={label} label={label}>
                {items.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              items.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.label}
                </option>
              ))
            ),
          )}
        </select>

        {field?.argument && (
          <ArgumentInput
            id={`${uid}-arg`}
            field={field}
            value={argumentOf(field, condition.field)}
            sequenceOptions={sequenceOptions}
            disabled={disabled}
            onChange={(argument) => onChange(setArgument(condition, field, argument))}
          />
        )}

        {field && (
          <select
            aria-label="Operador"
            disabled={disabled}
            className={selectClass}
            value={condition.operator}
            onChange={(e) => onChange(changeOperator(condition, field, e.target.value))}
          >
            {!operators.some((o) => o.id === condition.operator) && <option value={condition.operator}>{condition.operator}</option>}
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        )}

        {field &&
          slots.map((slot) => (
            <SlotInput key={slot.target} slot={slot} field={field} condition={condition} disabled={disabled} onChange={onChange} />
          ))}

        <button type="button" disabled={disabled} onClick={onRemove} aria-label="Quitar la condición" className="rounded p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {problem && <p className="text-[11px] text-amber-700 dark:text-amber-300">{problem}</p>}
      {field?.hint && !problem && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

/** Los campos agrupados para los `<optgroup>`; el campo actual (aunque ya no se ofrezca) se suma para que se vea. */
function groupFields(fields: BuilderField[], current: BuilderField | undefined): Array<{ label: string; items: BuilderField[] }> {
  const list = current && !fields.some((f) => f.path === current.path) ? [...fields, current] : fields;
  const out: Array<{ label: string; items: BuilderField[] }> = [];
  for (const f of list) {
    const label = f.group ?? "";
    const bucket = out.find((g) => g.label === label);
    if (bucket) bucket.items.push(f);
    else out.push({ label, items: [f] });
  }
  return out;
}

function ArgumentInput({
  id,
  field,
  value,
  sequenceOptions,
  disabled,
  onChange,
}: {
  id: string;
  field: BuilderField;
  value: string;
  sequenceOptions: FieldOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const label = field.argument?.label ?? "Dato del campo";
  if (field.argument?.kind === "sequence") {
    const options = optionsWithCurrent(sequenceOptions, [value]);
    return (
      <select id={id} aria-label={label} disabled={disabled} className={`${inputClass} !w-auto min-w-[8rem] !py-1`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elegí una secuencia</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.missing ? `${o.label} (ya no existe)` : o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      id={id}
      aria-label={label}
      disabled={disabled}
      className={`${inputClass} !w-auto min-w-[7rem] !py-1`}
      placeholder={field.argument?.placeholder ?? label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SlotInput({
  slot,
  field,
  condition,
  disabled,
  onChange,
}: {
  slot: ValueSlot;
  field: BuilderField;
  condition: BuilderCondition;
  disabled: boolean;
  onChange: (next: BuilderCondition) => void;
}) {
  const current = slot.target === "values" ? "" : ((slot.target === "value" ? condition.value : condition.value2) ?? "");

  function set(next: string) {
    onChange(slot.target === "value2" ? { ...condition, value2: next } : { ...condition, value: next });
  }

  switch (slot.kind) {
    case "options": {
      const options = optionsWithCurrent(field.options, [current]);
      return (
        <select aria-label={slot.label} disabled={disabled} className={`${inputClass} !w-auto min-w-[8rem] flex-1 !py-1`} value={current} onChange={(e) => set(e.target.value)}>
          <option value="">Elegí una opción</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.missing ? `${o.label} (ya no existe)` : o.label}
            </option>
          ))}
        </select>
      );
    }
    case "boolean":
      return (
        <select aria-label={slot.label} disabled={disabled} className={selectClass} value={current} onChange={(e) => set(e.target.value)}>
          <option value="">Elegí</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      );
    case "options-multi": {
      const selected = condition.values ?? [];
      const options = optionsWithCurrent(field.options, selected);
      if (options.length === 0) return <span className="text-xs text-muted-foreground">No hay opciones para elegir.</span>;
      return (
        <fieldset className="flex w-full flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border px-2 py-1.5">
          <legend className="sr-only">{slot.label}</legend>
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={checked}
                  onChange={() => onChange({ ...condition, values: checked ? selected.filter((v) => v !== o.value) : [...selected, o.value] })}
                />
                {o.missing ? `${o.label} (ya no existe)` : o.label}
              </label>
            );
          })}
        </fieldset>
      );
    }
    case "number":
    case "days":
      return (
        <input
          aria-label={slot.label}
          type="number"
          inputMode="decimal"
          min={slot.kind === "days" ? 0 : undefined}
          disabled={disabled}
          className={`${inputClass} !w-24 !py-1`}
          value={current}
          placeholder={slot.kind === "days" ? "días" : undefined}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "date":
      return <input aria-label={slot.label} type="date" disabled={disabled} className={`${inputClass} !w-auto !py-1`} value={current} onChange={(e) => set(e.target.value)} />;
    default:
      return (
        <input
          aria-label={slot.label}
          type="text"
          disabled={disabled}
          className={`${inputClass} !w-auto min-w-[7rem] flex-1 !py-1`}
          value={current}
          placeholder={slot.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      );
  }
}
