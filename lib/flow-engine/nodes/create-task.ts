/**
 * «Crear tarea» (Extra A, F22): un flujo deja una tarea para el equipo. Sirve con y sin contacto
 * (`needsContact: false`): con contacto, lo vincula; sin el, queda suelta.
 *
 * - Titulo, descripcion y proyecto admiten variables (`{{contact.name}}`, `{{answer.motivo}}`...).
 * - Responsable: una persona fija, «quien envio el reporte» (la persona del flujo sin contacto) o nadie. Si la persona
 *   elegida ya no es del equipo, la tarea queda sin responsable y se avisa a Owner/Admin.
 * - Vencimiento: una fecha fija o «+N dias desde hoy» (hoy en la zona del workspace).
 * - Origen `flow`, con `source_ref = flow_id:sesion:nodo`: la misma ejecucion no crea dos tareas abiertas.
 * - Sin titulo despues de interpolar: no crea y lo advierte. NUNCA lanza ni frena el flujo.
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { interpolateVariables } from "../interpolate";
import { todayInputValue } from "@/lib/dates";
import { addDays, isDateOnly } from "@/lib/tasks/dates";
import { createTaskFromAutomation } from "@/lib/tasks/create-from-automation";
import { TASK_LIMITS, TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/types";

export interface CreateTaskNodeData {
  title?: string;
  description?: string;
  /** `none`: sin responsable. `user`: la persona de `ownerId`. `member`: quien envio el reporte. */
  owner?: "none" | "user" | "member";
  ownerId?: string;
  followerIds?: string[];
  project?: string;
  priority?: TaskPriority;
  /** `none`: sin fecha. `date`: la de `dueDate`. `days`: hoy + `dueDays`. */
  dueMode?: "none" | "date" | "days";
  dueDate?: string;
  dueDays?: number;
}

export const MAX_DUE_DAYS = 365;

/** Una variable que no se pudo resolver queda como `{{...}}`: en una tarea es ruido, no un dato. Se saca. Puro. */
export function stripUnresolved(text: string): string {
  return text.replace(/\{\{[^}]*\}\}/g, "");
}

/** El vencimiento que pide el nodo, dado el «hoy» del workspace. Puro. */
export function resolveDue(data: Pick<CreateTaskNodeData, "dueMode" | "dueDate" | "dueDays">, today: string): string | null {
  if (data.dueMode === "date") return isDateOnly(data.dueDate) ? data.dueDate : null;
  if (data.dueMode === "days") {
    const n = Number(data.dueDays);
    if (!Number.isFinite(n)) return null;
    return addDays(today, Math.max(0, Math.min(MAX_DUE_DAYS, Math.trunc(n))));
  }
  return null;
}

/** La persona a cargo que pide el nodo, antes de comprobar que sea del equipo. Puro. */
export function resolveOwner(data: Pick<CreateTaskNodeData, "owner" | "ownerId">, memberUserId: string | null | undefined): string | null {
  if (data.owner === "user") return data.ownerId || null;
  if (data.owner === "member") return memberUserId ?? null;
  return null;
}

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<CreateTaskNodeData, FlowExecutionContext>) {
  try {
    const vars = context.variables ?? {};
    const title = stripUnresolved(interpolateVariables(data.title ?? "", vars)).replace(/\s+/g, " ").trim();
    if (!title) {
      console.warn(`[flow-engine] el nodo ${node.id} (Crear tarea) no tiene título: no se crea la tarea`);
      return;
    }

    const { data: workspace } = await supabase.from("workspaces").select("timezone").eq("id", context.workspaceId).maybeSingle();
    const today = todayInputValue(new Date(), workspace?.timezone || "UTC");

    const wantsOwner = (data.owner ?? "none") !== "none";
    await createTaskFromAutomation(supabase, {
      workspaceId: context.workspaceId,
      title: title.slice(0, TASK_LIMITS.title),
      description: data.description ? stripUnresolved(interpolateVariables(data.description, vars)).trim() : null,
      priority: (TASK_PRIORITIES as readonly string[]).includes(data.priority ?? "") ? data.priority : "normal",
      dueDate: resolveDue(data, today),
      ownerId: resolveOwner(data, context.memberUserId),
      followerIds: data.followerIds ?? [],
      project: data.project ? stripUnresolved(interpolateVariables(data.project, vars)).trim() : null,
      contactId: context.contactId,
      conversationId: context.conversationId || null,
      source: "flow",
      sourceRef: `${context.flowId}:${sessionId}:${node.id}`,
      actor: { kind: "flow", label: "Automatización", flowId: context.flowId, runId: sessionId, nodeId: node.id },
      // Elegir «nadie» es una decision; pedir una persona y que no haya nadie, no.
      notifyIfUnassigned: wantsOwner,
    });
  } catch (error) {
    console.error("[tareas] el nodo «Crear tarea» fallo:", error instanceof Error ? error.message : String(error));
  }
}

export const createTaskNode: NodeDefinition<CreateTaskNodeData> = {
  needsContact: false,
  type: "create_task",
  label: "Crear tarea",
  aliases: [{ nodeType: "action", actionType: "create_task" }],
  execute,
};
