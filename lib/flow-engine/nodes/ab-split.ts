import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { ABSplitNodeData } from "../types";

/**
 * Elige el camino de un A/B split segun el peso de cada uno. Devuelve el INDICE (o null sin caminos validos).
 *
 * Los pesos que no son un numero positivo no cuentan. Si ninguno cuenta, todos pesan lo mismo.
 */
export function pickSplitIndex(paths: ABSplitNodeData["paths"] | undefined, random: number = Math.random()): number | null {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0) return null;
  const weights = list.map((p) => (Number.isFinite(Number(p?.weight)) && Number(p.weight) > 0 ? Number(p.weight) : 0));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const effective = total > 0 ? weights : list.map(() => 1);
  const effectiveTotal = total > 0 ? total : list.length;
  const target = random * effectiveTotal;
  let cumulative = 0;
  for (let i = 0; i < effective.length; i++) {
    cumulative += effective[i];
    if (effective[i] > 0 && target < cumulative) return i;
  }
  return effective.findLastIndex((w) => w > 0);
}

/** La salida del lienzo para el camino `i` (el nodo dibuja `split-0`, `split-1`...). */
export const splitHandle = (index: number) => `split-${index}`;

/**
 * Reparte el trafico entre varias salidas segun el peso de cada una.
 *
 * Antes devolvia `handle:<nombre del camino>` ("A", "B") y el lienzo guarda las aristas con `split-0`, `split-1`: no
 * coincidian nunca y TODO A/B split dibujado en el lienzo cortaba el flujo ahi. El simulador lo tapaba porque caia a
 * "cualquier arista".
 */
export const abSplitNode: NodeDefinition<ABSplitNodeData> = {
  needsContact: false,
  type: "abSplit",
  label: "A/B split",
  aliases: [{ nodeType: "action", actionType: "abSplit" }],
  execute({ data }: NodeExecutionArgs<ABSplitNodeData, FlowExecutionContext>) {
    const index = pickSplitIndex(data?.paths);
    if (index === null) {
      console.warn("[flow-engine] un A/B split sin caminos: el flujo sigue por la primera salida");
      return;
    }
    return `handle:${splitHandle(index)}`;
  },
};
