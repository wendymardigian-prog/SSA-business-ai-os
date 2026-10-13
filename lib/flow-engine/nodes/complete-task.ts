/**
 * «Completar tarea» (Tareas × CRM, R4): un flujo cierra la(s) tarea(s) abierta(s) que tienen su clave de origen.
 *
 * - Un solo campo: la clave de origen (`sourceKey`), con variables (`payment:{{payment.id}}`). La misma que se le pone a
 *   «Crear tarea».
 * - Completa las tareas abiertas, no borradas, del workspace con ESE `source_ref`, como lo haria una persona pero sin mover
 *   fechas de las dependientes (nunca pide confirmacion). Historial con el sistema como actor, los avisos de siempre y el
 *   evento `task_completed`.
 * - Si la clave queda vacia o con una variable sin resolver, o si no hay tarea que coincida, no hace nada y el flujo sigue.
 *   Jamas cierra una tarea que no coincide: no se puede cerrar una tarea manual por error.
 * - Sirve con y sin contacto (`needsContact: false`). NUNCA lanza ni frena el flujo.
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { completeTasksFromAutomation } from "@/lib/tasks/complete-from-automation";
import { resolveSourceKey } from "./create-task";

export interface CompleteTaskNodeData {
  /** La clave de origen de la(s) tarea(s) a cerrar, con variables. */
  sourceKey?: string;
}

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<CompleteTaskNodeData, FlowExecutionContext>) {
  try {
    const key = resolveSourceKey(data.sourceKey, context.variables ?? {});
    if (!key) {
      console.warn(`[flow-engine] el nodo ${node.id} (Completar tarea) no tiene una clave de origen resuelta: no se completa nada`);
      return;
    }
    await completeTasksFromAutomation(supabase, {
      workspaceId: context.workspaceId,
      sourceRef: key,
      actor: { label: "Automatización", flowId: context.flowId, runId: sessionId, nodeId: node.id },
    });
  } catch (error) {
    console.error("[tareas] el nodo «Completar tarea» fallo:", error instanceof Error ? error.message : String(error));
  }
}

export const completeTaskNode: NodeDefinition<CompleteTaskNodeData> = {
  needsContact: false,
  type: "complete_task",
  label: "Completar tarea",
  aliases: [{ nodeType: "action", actionType: "complete_task" }],
  execute,
};
