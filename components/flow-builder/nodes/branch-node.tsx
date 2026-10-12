"use client";

import { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { pathDisplayLabel } from "@/lib/automations/branch-edit";
import { BRANCH_ELSE_HANDLE, BRANCH_ELSE_LABEL, pathsOf } from "@/lib/flow-engine/branch-paths";
import type { BranchNodeData } from "@/lib/flow-engine/condition-eval";

/**
 * "Condiciones": una salida por camino, en el orden en que se evaluan, y "Si no"
 * siempre al final. El `id` de cada salida ES el id del camino (lo que sigue el
 * motor: `handle:<id>`); la de "Si no" es `else`.
 */

const SLOT = 96;

export function BranchNode({ id, data, selected }: NodeProps) {
  const nodeData = data as Partial<BranchNodeData> & { label?: string };
  const paths = pathsOf(nodeData);
  const updateNodeInternals = useUpdateNodeInternals();
  const slots = paths.length + 1;

  // Las salidas cambian cuando se agrega, borra o reordena un camino: el canvas tiene que volver a medirlas.
  const signature = paths.map((p) => p.id).join("|");
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, signature, updateNodeInternals]);

  return (
    <div
      className={cn("rounded-lg border bg-card shadow-sm transition-shadow", selected ? "border-indigo-500 shadow-md" : "border-border")}
      style={{ width: Math.max(224, slots * SLOT) }}
    >
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-indigo-500 !bg-white" />
      <div className="flex items-center gap-2 rounded-t-lg bg-indigo-500 px-3 py-2 text-white">
        <Split className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Condiciones</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{nodeData.label || "Según una respuesta"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {paths.length === 0 ? "Sin caminos todavía" : `${paths.length} ${paths.length === 1 ? "camino" : "caminos"} y «${BRANCH_ELSE_LABEL}»`}
        </p>
      </div>
      <div className="flex border-t border-border pb-1.5 pt-1.5">
        {[...paths.map((p, i) => ({ key: p.id, label: pathDisplayLabel(p, i), tone: "text-indigo-600 dark:text-indigo-300" })), { key: BRANCH_ELSE_HANDLE, label: BRANCH_ELSE_LABEL, tone: "text-muted-foreground" }].map((slot) => (
          <span key={slot.key} className={cn("min-w-0 flex-1 truncate px-1 text-center text-[10px] font-medium", slot.tone)} title={slot.label}>
            {slot.label}
          </span>
        ))}
      </div>
      {paths.map((p, i) => (
        <Handle
          key={p.id}
          type="source"
          position={Position.Bottom}
          id={p.id}
          style={{ left: `${((i + 0.5) / slots) * 100}%` }}
          className="!h-3 !w-3 !border-2 !border-indigo-500 !bg-white"
        />
      ))}
      <Handle
        type="source"
        position={Position.Bottom}
        id={BRANCH_ELSE_HANDLE}
        style={{ left: `${((paths.length + 0.5) / slots) * 100}%` }}
        className="!h-3 !w-3 !border-2 !border-muted-foreground !bg-white"
      />
    </div>
  );
}
