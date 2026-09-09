import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { GoToFlowNodeData } from "../types";

/**
 * Salta a otro flow.
 *
 * El salto es de ida: el flow original no continua despues. `returnAfter` esta
 * declarado en el tipo del nodo pero todavia no hace nada — volver requiere una
 * pila de flows en la sesion (la columna flow_stack existe y esta sin usar), y
 * eso es mas que un arreglo puntual. Queda anotado como deuda.
 *
 * El motor se pasa por `runtime` y no por import para no armar un ciclo entre
 * engine.ts y el registro.
 */
export const goToFlowNode: NodeDefinition<GoToFlowNodeData> = {
  type: "goToFlow",
  label: "Ir a otro flow",
  aliases: [{ nodeType: "action", actionType: "goToFlow" }],
  async execute({ supabase, data, context, runtime }: NodeExecutionArgs<GoToFlowNodeData>) {
    await runtime.executeFlow(supabase, { ...context, flowId: data.flowId });
    return "pause";
  },
};
