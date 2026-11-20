"use client";

import { useMemo } from "react";
import { PathConditions } from "@/components/automations/path-conditions";
import { useConditionCatalog, useConditionGroups } from "@/components/automations/use-condition-catalog";
import type { BranchCondition } from "@/lib/flow-engine/condition-eval";

/**
 * «Solo si…» de un disparador: condiciones extra sobre los datos del disparador y del contacto, con el mismo editor
 * que el paso «Condiciones». Se guarda en `onlyIf` (lo evalúa el motor antes de arrancar: `trigger-only-if.ts`).
 */
export function TriggerOnlyIfSection({ flowId, data, onChange }: { flowId?: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  // Lo que cambia el catálogo es el disparador, no las condiciones: sin `onlyIf` en la huella, editar una condición
  // no vuelve a pedir los campos al servidor.
  const triggerData = useMemo(() => {
    const rest = { ...data };
    delete rest.onlyIf;
    return rest;
  }, [data]);
  const { inputs, error } = useConditionCatalog(flowId ?? "", triggerData);
  const groups = useConditionGroups(inputs, []);
  const saved = (data.onlyIf ?? null) as { logic?: "and" | "or"; conditions?: BranchCondition[] } | null;
  const path = useMemo(() => ({ logic: saved?.logic === "or" ? ("or" as const) : ("and" as const), conditions: Array.isArray(saved?.conditions) ? saved.conditions : [] }), [saved]);

  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">Solo si…</legend>
      <p className="text-xs text-muted-foreground">
        Condiciones extra sobre los datos del disparador o del contacto. Si no se cumplen, la automatización no arranca y la persona puede entrar más adelante, cuando sí se cumplan. Sin condiciones, arranca siempre.
      </p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {inputs || error ? (
        <PathConditions
          path={path}
          groups={groups}
          onChange={(next) => {
            const nextData = { ...data };
            if (next.conditions.length > 0) nextData.onlyIf = { logic: next.logic, conditions: next.conditions };
            else delete nextData.onlyIf;
            onChange(nextData);
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Cargando los campos…</p>
      )}
    </fieldset>
  );
}
