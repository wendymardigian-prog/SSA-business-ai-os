import type { SequenceStep } from "@/lib/types/database";

/**
 * Deteccion de cambios sin guardar.
 *
 * La logica vive aca, separada del hook, por dos motivos: es lo unico que
 * merece un test, y Vitest corre en environment "node" sin jsdom, asi que un
 * hook de React no se puede testear hoy. Misma separacion que entre
 * lib/auth/roles.ts (puro) y lib/auth/guards.ts.
 *
 * La estrategia es comparar huellas de texto en vez de objetos: la comparacion
 * queda en un `!==`, el hook no re-renderiza de mas, y lo dificil —decidir que
 * cuenta como cambio— queda de este lado, con pruebas.
 */

/**
 * Serializa de forma estable: dos objetos con las mismas claves en distinto
 * orden dan la misma huella.
 */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const ordenado: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        ordenado[k] = (val as Record<string, unknown>)[k];
      }
      return ordenado;
    }
    return val;
  });
}

/**
 * Huella de una secuencia.
 *
 * Solo lo que se edita a mano. `status` queda afuera porque lo cambian los
 * botones de activar y pausar, que guardan por su cuenta: incluirlo haria que
 * la secuencia figure como "sin guardar" justo despues de activarla.
 */
export function sequenceFingerprint(input: {
  name: string;
  description: string | null;
  steps: SequenceStep[];
}): string {
  return fingerprint({
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    steps: input.steps,
  });
}

/** Lo minimo de un nodo del canvas que representa una edicion de verdad. */
interface CanvasNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: unknown;
}

interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Huella del grafo de un flow.
 *
 * Normaliza a proposito. React Flow escribe `selected`, `dragging`, `measured`,
 * `width` y `height` sobre los mismos objetos del array, asi que comparar el
 * array crudo daria "hay cambios" con solo hacerle click a un nodo. Y reordena
 * el array al seleccionar, para dibujar el nodo activo arriba: sin ordenar por
 * id, eso tambien contaria como edicion.
 *
 * Sin esta normalizacion el aviso aparece siempre, y un aviso que aparece
 * siempre lo termina sacando alguien.
 *
 * `position` no se redondea: mover un nodo medio pixel es una edicion real.
 */
export function flowFingerprint(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  name: string
): string {
  const nodosLimpios = [...nodes]
    .map((n) => ({
      id: n.id,
      type: n.type ?? null,
      position: n.position ? { x: n.position.x, y: n.position.y } : null,
      data: n.data ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const aristasLimpias = [...edges]
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return fingerprint({ name: name.trim(), nodes: nodosLimpios, edges: aristasLimpias });
}
