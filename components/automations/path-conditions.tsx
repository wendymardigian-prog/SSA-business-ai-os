"use client";

import { useMemo } from "react";
import { ConditionBuilder } from "@/components/automations/condition-builder";
import { offeredFields, recognizedFields, type BuilderCondition } from "@/lib/automations/condition-builder-model";
import { staleConditions, type ConditionFieldGroup } from "@/lib/flow-engine/condition-catalog";
import type { BranchCondition, BranchPath } from "@/lib/flow-engine/condition-eval";

/**
 * Las condiciones de UN camino de "Condiciones": el constructor general con los
 * campos del punto del flujo donde esta el nodo. Lo comparten el panel del
 * canvas y el editor de pasos.
 *
 * Un camino es una lista de condiciones con un solo "y / o" (no hay grupos
 * anidados: el primero que se cumple, en orden, gana, asi que "esto o aquello
 * pero ademas lo otro" se arma con dos caminos).
 */

/** Lo que se guarda no lleva la clave de React del constructor. */
function toSaved(conditions: BuilderCondition[]): BranchCondition[] {
  return conditions.map((c) => {
    const { id: _id, ...rest } = c;
    void _id;
    return rest;
  });
}

export function PathConditions({
  path,
  groups,
  onChange,
  disabled,
}: {
  path: Pick<BranchPath, "logic" | "conditions">;
  groups: ConditionFieldGroup[];
  onChange: (next: Pick<BranchPath, "logic" | "conditions">) => void;
  disabled?: boolean;
}) {
  const fields = useMemo(() => offeredFields(groups), [groups]);
  const known = useMemo(() => recognizedFields(groups), [groups]);
  const sequenceOptions = useMemo(
    () => (groups.flatMap((g) => g.fields).find((f) => f.path === "contact.sequences")?.options ?? []),
    [groups],
  );

  // "Esta pregunta ya no existe en el formulario": la condicion se queda a la vista, con el aviso.
  const stale = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staleConditions({ logic: path.logic, conditions: path.conditions }, groups)) map.set(s.field, s.message);
    return map;
  }, [path.logic, path.conditions, groups]);

  return (
    <ConditionBuilder
      value={{ rootConjunction: path.logic, conditions: path.conditions, groups: [] }}
      onChange={(next) => onChange({ logic: next.rootConjunction, conditions: toSaved(next.conditions) })}
      fields={fields}
      recognized={known}
      sequenceOptions={sequenceOptions}
      allowGroups={false}
      leadLabel="Este camino se cumple si"
      emptyHint="Sin condiciones: este camino se cumple siempre."
      staleFor={(c) => stale.get(c.field) ?? null}
      disabled={disabled}
    />
  );
}
