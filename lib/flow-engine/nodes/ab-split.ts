import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { ABSplitNodeData } from "../types";

/** Reparte el trafico entre varias salidas segun el peso de cada una. */
export const abSplitNode: NodeDefinition<ABSplitNodeData> = {
  needsContact: false,
  type: "abSplit",
  label: "A/B split",
  aliases: [{ nodeType: "action", actionType: "abSplit" }],
  execute({ data }: NodeExecutionArgs<ABSplitNodeData, FlowExecutionContext>) {
    const totalWeight = data.paths.reduce((sum, p) => sum + p.weight, 0);
    const random = Math.random() * totalWeight;

    let cumulative = 0;
    for (const path of data.paths) {
      cumulative += path.weight;
      if (random <= cumulative) return `handle:${path.name}`;
    }
    return `handle:${data.paths[0].name}`;
  },
};
