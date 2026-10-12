"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Edge, Node } from "@xyflow/react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PathConditions } from "@/components/automations/path-conditions";
import { useConditionCatalog, useConditionGroups } from "@/components/automations/use-condition-catalog";
import { addPath, blankBranchPath, canAddPath, canRemovePath, movePath, patchPath, pathDisplayLabel, removePath, renamePath } from "@/lib/automations/branch-edit";
import { blankCondition, offeredFields } from "@/lib/automations/condition-builder-model";
import { MAX_PATHS, pathsOf, validateBranchData } from "@/lib/flow-engine/branch-paths";
import { BRANCH_ELSE_LABEL } from "@/lib/flow-engine/branch-paths";
import { upstreamOf } from "@/lib/flow-engine/condition-catalog";
import type { BranchNodeData, BranchPath } from "@/lib/flow-engine/condition-eval";

/**
 * Configuracion del nodo "Condiciones" en el canvas: los caminos en el orden en
 * que se evaluan, cada uno con su nombre y sus condiciones, y "Si no" fijo al
 * final. El id de cada camino ES su salida: renombrar o mover no rompe a donde
 * llevaba. Borrar un camino suelta las conexiones que salian de el.
 */

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function BranchPanel({
  flowId,
  nodeId,
  data: rawData,
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
  const data = rawData as unknown as Partial<BranchNodeData> & Record<string, unknown>;
  const paths = pathsOf(data);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

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
  const fields = useMemo(() => offeredFields(groups), [groups]);

  function setPaths(next: BranchPath[]) {
    onChange({ ...data, paths: next });
  }

  function askRemove(path: BranchPath) {
    // Un camino que lleva a otros pasos: avisar antes de soltar la conexion.
    if (edges.some((e) => e.source === nodeId && e.sourceHandle === path.id)) setConfirmRemove(path.id);
    else setPaths(removePath(paths, path.id));
  }

  const problems = validateBranchData({ paths });
  const noConditionPaths = paths.filter((p) => !Array.isArray(p.conditions) || p.conditions.length === 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Va por el <strong>primer</strong> camino cuyas condiciones se cumplen, en el orden de la lista. Si no se cumple ninguno, sigue por «{BRANCH_ELSE_LABEL}».
      </p>

      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <ol className="space-y-3">
        {paths.map((path, index) => (
          <li key={path.id} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">{index + 1}.</span>
              <label htmlFor={`path-${path.id}-name`} className="sr-only">
                Nombre del camino {index + 1}
              </label>
              <input
                id={`path-${path.id}-name`}
                type="text"
                value={path.label}
                placeholder={`Camino ${index + 1}`}
                onChange={(e) => setPaths(renamePath(paths, path.id, e.target.value))}
                onBlur={() => path.label.trim() === "" && setPaths(renamePath(paths, path.id, pathDisplayLabel(path, index)))}
                className={`${inputClass} !py-1`}
              />
              <button
                type="button"
                onClick={() => setPaths(movePath(paths, path.id, -1))}
                disabled={index === 0}
                aria-label={`Subir el camino ${pathDisplayLabel(path, index)}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPaths(movePath(paths, path.id, 1))}
                disabled={index === paths.length - 1}
                aria-label={`Bajar el camino ${pathDisplayLabel(path, index)}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => askRemove(path)}
                disabled={!canRemovePath(paths.length)}
                aria-label={`Borrar el camino ${pathDisplayLabel(path, index)}`}
                title={canRemovePath(paths.length) ? undefined : "Tiene que quedar al menos un camino"}
                className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {inputs || error ? (
              <PathConditions path={path} groups={groups} onChange={(next) => setPaths(patchPath(paths, path.id, next))} />
            ) : (
              // Hasta que no cargan los campos, todo parecería "ya no existe".
              <p className="text-xs text-muted-foreground">Cargando los campos para comparar…</p>
            )}
          </li>
        ))}

        <li className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">{BRANCH_ELSE_LABEL}</p>
          <p className="text-xs text-muted-foreground">Si no se cumple ninguno de los caminos de arriba. Siempre está al final y no se borra.</p>
        </li>
      </ol>

      <button
        type="button"
        disabled={!canAddPath(paths.length)}
        onClick={() => setPaths(addPath(paths, (id, label) => blankBranchPath(id, label, fields[0] ? blankCondition(fields[0]) : undefined)))}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {canAddPath(paths.length) ? "Agregar camino" : `Máximo ${MAX_PATHS} caminos`}
      </button>

      {noConditionPaths.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Un camino sin condiciones se cumple siempre: los que vienen después nunca se van a evaluar.
        </p>
      )}
      {paths.length > 0 && problems.length > 0 && noConditionPaths.length === 0 && (
        <ul className="list-inside list-disc text-[11px] text-amber-700 dark:text-amber-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Borrar el camino"
        message="Este camino lleva a otros pasos. Si lo borrás, esa conexión se suelta (los pasos quedan en el canvas, sin conectar)."
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          if (confirmRemove) setPaths(removePath(paths, confirmRemove));
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
