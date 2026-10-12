/**
 * Editar la lista de caminos de un nodo "Condiciones": agregar, renombrar,
 * reordenar y borrar. PURO. Lo usan dos pantallas con la MISMA lista: el panel
 * del canvas (`BranchPanel`) y el editor de pasos (`step-tree-editor`), asi las
 * dos respetan los mismos limites y los mismos nombres.
 *
 * Los ids de los caminos no cambian nunca (son la salida del nodo): renombrar o
 * mover un camino no rompe a donde llevaba. Las funciones son genericas sobre
 * el camino para que el editor de pasos pueda llevar los pasos de cada camino
 * adentro sin que esto se entere.
 */

import { MAX_LABEL_LENGTH, MAX_PATHS, MIN_PATHS, isReservedPathId, newPathId } from "@/lib/flow-engine/branch-paths";
import type { BranchCondition, BranchPath } from "@/lib/flow-engine/condition-eval";

/** Lo minimo que tiene que tener un camino para estas operaciones. */
export interface PathLike {
  id: string;
  label: string;
}

/** El nombre que se ve: el que se escribio, o "Camino N" si esta vacio. */
export function pathDisplayLabel(path: PathLike, index: number): string {
  const label = typeof path.label === "string" ? path.label.trim() : "";
  return label !== "" ? label : `Camino ${index + 1}`;
}

/** El primer "Camino N" que no choca con los nombres que ya hay. */
export function nextPathLabel(paths: PathLike[]): string {
  const taken = new Set(paths.map((p, i) => pathDisplayLabel(p, i)));
  for (let n = paths.length + 1; n < paths.length + 1000; n++) {
    const label = `Camino ${n}`;
    if (!taken.has(label)) return label;
  }
  return `Camino ${paths.length + 1}`;
}

export function canAddPath(count: number): boolean {
  return count < MAX_PATHS;
}

export function canRemovePath(count: number): boolean {
  return count > MIN_PATHS;
}

/**
 * Suma un camino al final (antes de "Si no", que no es parte de la lista). Con el
 * maximo alcanzado devuelve la lista tal cual.
 */
export function addPath<P extends PathLike>(paths: P[], make: (id: string, label: string) => P, random?: () => number, forcedId?: string): P[] {
  if (!canAddPath(paths.length)) return paths;
  const taken = paths.map((p) => p.id);
  // Quien llama puede elegir el id de antemano (para saber cual es el camino nuevo y, por ejemplo, abrirlo).
  const id = forcedId && !taken.includes(forcedId) && !isReservedPathId(forcedId) ? forcedId : newPathId(taken, random);
  return [...paths, make(id, nextPathLabel(paths))];
}

/** Un camino de "Condiciones" nuevo, con una condicion en blanco para que no nazca vacio. */
export function blankBranchPath(id: string, label: string, firstCondition?: BranchCondition): BranchPath {
  return { id, label, logic: "and", conditions: firstCondition ? [firstCondition] : [] };
}

export function removePath<P extends PathLike>(paths: P[], id: string): P[] {
  if (!canRemovePath(paths.length)) return paths;
  return paths.filter((p) => p.id !== id);
}

/** Cambia el nombre. Un nombre vacio se queda vacio (se ve como "Camino N"); uno largo se corta. */
export function renamePath<P extends PathLike>(paths: P[], id: string, label: string): P[] {
  const clipped = label.length > MAX_LABEL_LENGTH ? label.slice(0, MAX_LABEL_LENGTH) : label;
  return paths.map((p) => (p.id === id ? { ...p, label: clipped } : p));
}

/** Mueve un camino una posicion arriba (-1) o abajo (+1). En los bordes no hace nada. */
export function movePath<P extends PathLike>(paths: P[], id: string, direction: -1 | 1): P[] {
  const from = paths.findIndex((p) => p.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= paths.length) return paths;
  const next = [...paths];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Cambia cualquier otra cosa de un camino (sus condiciones, su "y / o"). */
export function patchPath<P extends PathLike>(paths: P[], id: string, patch: Partial<P>): P[] {
  return paths.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p));
}

/**
 * Al guardar, un nombre vacio pasa a ser "Camino N" (la base lo exige y asi el
 * historial del contacto dice por donde fue). No toca los que ya tienen nombre.
 */
export function fillPathLabels<P extends PathLike>(paths: P[]): P[] {
  return paths.map((p, i) => (typeof p.label === "string" && p.label.trim() !== "" ? p : { ...p, label: `Camino ${i + 1}` }));
}

/**
 * Al cambiar los caminos de un nodo en el canvas, las conexiones que salian de
 * un camino que ya no existe se sueltan. Sin esto quedarian apuntando a una
 * salida que el nodo ya no tiene (y el motor nunca las seguiria).
 *
 * Solo toca las conexiones que salen de ESTE nodo con una salida desconocida;
 * las que salen sin salida declarada no se tocan (ya eran asi).
 */
export function pruneBranchEdges<E extends { source: string; sourceHandle?: string | null }>(nodeId: string, paths: Array<{ id: string }>, edges: E[]): E[] {
  const valid = new Set<string>([...paths.map((p) => p.id), "else"]);
  return edges.filter((e) => e.source !== nodeId || !e.sourceHandle || valid.has(e.sourceHandle));
}
