"use client";

import { useMemo } from "react";
import { PathConditions } from "@/components/automations/path-conditions";
import { useConditionCatalog, useConditionGroups } from "@/components/automations/use-condition-catalog";
import type { BranchCondition } from "@/lib/flow-engine/condition-eval";

export interface OnlyIfValue {
  logic: "and" | "or";
  conditions: BranchCondition[];
}

/**
 * El editor del «Solo si…» de un disparador, controlado: el valor y el cambio los maneja quien lo usa (el panel del
 * lienzo o el editor de pasos de la Agenda). Mismo editor que el paso «Condiciones». Se guarda en `onlyIf` y lo evalúa
 * el motor antes de arrancar (`lib/flow-engine/trigger-only-if.ts`).
 */
export function OnlyIfEditor({
  flowId,
  triggerData,
  value,
  onChange,
}: {
  flowId?: string;
  /** Los datos del disparador (con `triggerType`): deciden qué campos se pueden comparar. Sin `onlyIf`. */
  triggerData: Record<string, unknown>;
  value: OnlyIfValue | null;
  onChange: (next: OnlyIfValue | null) => void;
}) {
  const { inputs, error } = useConditionCatalog(flowId ?? "", triggerData);
  const groups = useConditionGroups(inputs, []);
  const path = useMemo(() => ({ logic: value?.logic === "or" ? ("or" as const) : ("and" as const), conditions: value?.conditions ?? [] }), [value]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Condiciones extra sobre los datos del disparador o del contacto. Si no se cumplen, la automatización no arranca y la persona puede entrar más adelante, cuando sí se cumplan. Sin condiciones, arranca siempre.
      </p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {inputs || error ? (
        <PathConditions path={path} groups={groups} onChange={(next) => onChange(next.conditions.length > 0 ? { logic: next.logic, conditions: next.conditions } : null)} />
      ) : (
        <p className="text-xs text-muted-foreground">Cargando los campos…</p>
      )}
    </div>
  );
}

/** El «Solo si…» en el panel del disparador del lienzo: lee y escribe `onlyIf` en los datos del nodo. */
export function TriggerOnlyIfSection({ flowId, data, onChange }: { flowId?: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  // Lo que cambia el catálogo es el disparador, no las condiciones: sin `onlyIf` en la huella, editar una condición
  // no vuelve a pedir los campos al servidor.
  const triggerData = useMemo(() => {
    const rest = { ...data };
    delete rest.onlyIf;
    return rest;
  }, [data]);
  const saved = (data.onlyIf ?? null) as { logic?: "and" | "or"; conditions?: BranchCondition[] } | null;
  const value = useMemo<OnlyIfValue | null>(
    () => (saved && Array.isArray(saved.conditions) && saved.conditions.length > 0 ? { logic: saved.logic === "or" ? "or" : "and", conditions: saved.conditions } : null),
    [saved],
  );

  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">Solo si…</legend>
      <OnlyIfEditor
        flowId={flowId}
        triggerData={triggerData}
        value={value}
        onChange={(next) => {
          const nextData = { ...data };
          if (next) nextData.onlyIf = next;
          else delete nextData.onlyIf;
          onChange(nextData);
        }}
      />
    </fieldset>
  );
}
