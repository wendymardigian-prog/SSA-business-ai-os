"use client";

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { QualifyLeadFields } from "@/components/automations/qualify-lead-fields";
import { useConditionCatalog, useConditionGroups } from "@/components/automations/use-condition-catalog";
import { upstreamOf } from "@/lib/flow-engine/condition-catalog";
import type { QualifyLeadStepData } from "@/lib/flow-engine/qualify-lead";

/**
 * «Calificar lead» en el lienzo: el mismo formulario que el editor de pasos, con
 * los campos que hay en este punto del flujo para las reglas (como «Condiciones»).
 */
export function QualifyLeadPanel({
  flowId,
  nodeId,
  data,
  nodes,
  edges,
  onChange,
}: {
  flowId: string;
  nodeId: string;
  data: Record<string, unknown>;
  nodes: Node[];
  edges: Edge[];
  onChange: (data: Record<string, unknown>) => void;
}) {
  const triggerData = nodes.find((n) => n.type === "trigger")?.data as Record<string, unknown> | undefined;
  const { inputs, error } = useConditionCatalog(flowId, triggerData);
  const upstream = useMemo(
    () =>
      upstreamOf(
        { nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? "", data: n.data })), edges: edges.map((e) => ({ source: e.source, target: e.target })) },
        nodeId,
      ),
    [nodes, edges, nodeId],
  );
  const groups = useConditionGroups(inputs, upstream);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Cambia el nivel de calificación del contacto (del 1 al 5). Los nombres de cada nivel se eligen en Ajustes → Estados.
      </p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <QualifyLeadFields
        idPrefix={`qualify-${nodeId}`}
        data={data as Partial<QualifyLeadStepData>}
        patch={(next) => onChange({ ...data, ...next })}
        groups={groups}
        inputClassName="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
