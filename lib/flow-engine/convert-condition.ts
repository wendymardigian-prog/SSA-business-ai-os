/**
 * "Convertir a Condiciones": de un nodo `condition` (Si / Si no) a un nodo
 * `branch` con UN camino, sin cambiar a donde va nadie. PURO.
 *
 * Lo que se conserva TAL CUAL:
 *  - las condiciones, con el operador viejo y sin `valueType` (asi se siguen
 *    evaluando con la semantica de siempre, ver `condition-eval.ts`);
 *  - el id del nodo y su posicion (una sesion pausada despues no se pierde);
 *  - a donde llevaban las salidas: la de "Si" (`true`, o el alias viejo `yes`)
 *    pasa a ser la del camino, y la de "Si no" (`false` / `no`) pasa a ser `else`.
 *
 * Una arista que salia del nodo SIN salida declarada nunca la sigue el motor
 * (ni antes ni ahora): queda como estaba.
 */

import type { BranchCondition, BranchNodeData, BranchPath } from "./condition-eval";
import { BRANCH_ELSE_HANDLE, newPathId } from "./branch-paths";

export interface ConvertibleNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: unknown;
}

export interface ConvertibleEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
  [key: string]: unknown;
}

export const CONVERTED_PATH_LABEL = "Si";

/** El `true` y el `false` del nodo viejo, con los alias que el motor todavia acepta. */
const TRUE_HANDLES = new Set(["true", "yes"]);
const FALSE_HANDLES = new Set(["false", "no"]);

export function isLegacyCondition(node: { type: string }): boolean {
  return node.type === "condition";
}

export interface ConvertedCondition<N extends ConvertibleNode, E extends ConvertibleEdge> {
  node: Omit<N, "type" | "data"> & { type: "branch"; data: BranchNodeData };
  edges: E[];
  /** El id del camino creado (el que ahora lleva la salida "Si"). */
  pathId: string;
}

export function conditionToBranch<N extends ConvertibleNode, E extends ConvertibleEdge>(
  node: N,
  edges: E[],
  options: { pathId?: string } = {},
): ConvertedCondition<N, E> {
  const data = (node.data ?? {}) as { conditions?: unknown; logic?: unknown; label?: unknown };
  const conditions = (Array.isArray(data.conditions) ? data.conditions : []).filter(
    (c): c is Record<string, unknown> => !!c && typeof c === "object",
  ) as unknown as BranchCondition[];

  const pathId = options.pathId ?? newPathId();
  const path: BranchPath = {
    id: pathId,
    label: CONVERTED_PATH_LABEL,
    // El nodo viejo solo distingue "and": cualquier otra cosa se comporta como "o".
    logic: data.logic === "and" ? "and" : "or",
    conditions: conditions.map((c) => ({ ...c })),
  };

  const branch = {
    ...node,
    type: "branch" as const,
    data: { ...(typeof data.label === "string" ? { label: data.label } : {}), paths: [path] } satisfies BranchNodeData,
  };

  const converted = edges.map((edge) => {
    if (edge.source !== node.id) return edge;
    const handle = edge.sourceHandle ?? undefined;
    if (handle && TRUE_HANDLES.has(handle)) return { ...edge, sourceHandle: pathId };
    if (handle && FALSE_HANDLES.has(handle)) return { ...edge, sourceHandle: BRANCH_ELSE_HANDLE };
    return edge;
  });

  return { node: branch as ConvertedCondition<N, E>["node"], edges: converted, pathId };
}
