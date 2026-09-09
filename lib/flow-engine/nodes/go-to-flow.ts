import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { GoToFlowNodeData } from "../types";

/**
 * Salta a otro flow.
 *
 * El salto es de ida: el flow original no continua despues.
 *
 * Antes esto dejaba una fuga. El nodo arrancaba el flow destino (que abre su
 * propia sesion) y devolvia "pause", lo que corta el recorrido del flow padre
 * SIN cerrar su sesion. Esa sesion quedaba `active`, con waiting_for_input en
 * false y waiting_until en null: no la despierta el cron —no hay job— ni un
 * mensaje entrante —el motor solo retoma sesiones que esperan input—. Quedaba
 * viva para siempre, y ademas bloqueaba el flow siguiente del contacto.
 *
 * Ahora la sesion del padre se cierra antes de saltar, que es lo que
 * corresponde a un salto de ida.
 *
 * `returnAfter` sigue sin hacer nada y el panel lo muestra deshabilitado.
 * Volver requiere una pila de flows en la sesion (la columna flow_stack existe
 * desde la 00001 y nunca se uso), reescribir completeSession y sus cinco
 * llamadores, y decidir que pasa con las variables en el cruce. Es su propia
 * pasada; queda anotado en la bitacora.
 *
 * El motor se pasa por `runtime` y no por import para no armar un ciclo entre
 * engine.ts y el registro.
 */
export const goToFlowNode: NodeDefinition<GoToFlowNodeData> = {
  type: "goToFlow",
  label: "Ir a otro flow",
  aliases: [{ nodeType: "action", actionType: "goToFlow" }],
  async execute({ supabase, data, context, sessionId, runtime }: NodeExecutionArgs<GoToFlowNodeData>) {
    if (!data.flowId) {
      console.error("[goToFlow] el nodo no tiene flow destino configurado");
      return;
    }

    // Cerrar antes de saltar: el flow destino abre su propia sesion, y dos
    // sesiones activas para el mismo contacto y canal se pisan entre si.
    // Solo se cierra si sigue activa, para no pisar una cancelacion en curso.
    await supabase
      .from("flow_sessions")
      .update({ status: "completed" })
      .eq("id", sessionId)
      .eq("status", "active");

    await runtime.executeFlow(supabase, { ...context, flowId: data.flowId });
    return "pause";
  },
};
