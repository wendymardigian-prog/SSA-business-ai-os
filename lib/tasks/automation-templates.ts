/**
 * Los dos flujos de cobranza con tareas (Tareas × CRM, R5): «Crear una tarea cuando un pago vence».
 *
 *   1. `task_payment_overdue` — «Cobranza · Tarea al vencer un pago»: cuando un pago pasa a vencido, deja una tarea para el
 *      vendedor de la venta (vence hoy, prioridad alta, proyecto «Cobranza»), con la clave `payment:<id del pago>`.
 *   2. `task_payment_paid_close` — «Cobranza · Cerrar la tarea al cobrar»: cuando el pago se cobra, completa esa tarea.
 *
 * Viven APARTE de los cuatro flujos de email/WhatsApp de Ventas (`lib/sales/automation/templates.ts`): sus claves no estan en
 * `SALES_TEMPLATE_KEYS`, asi la regla de «Crear flujos de cobranza» no los mezcla. El estado del interruptor se lee del flujo
 * (publicado = encendido): no hay columna nueva.
 *
 * `ensureTaskPaymentFlows` es idempotente por `flows.template_key`; si una persona edito el grafo de un flujo, no se pisa:
 * solo se cambia su estado (publicado / borrador).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listTriggers, resolveNodeType } from "@/lib/flow-engine/registry";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { publishFlow, unpublishFlow } from "@/lib/flow-engine/publish";
import type { Database, Json } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

import { TASK_PAYMENT_TEMPLATE_KEYS, type TaskPaymentFlow, type TaskPaymentState, type TaskPaymentTemplateKey } from "./payment-tasks-types";

export { TASK_PAYMENT_TEMPLATE_KEYS };
export type { TaskPaymentFlow, TaskPaymentState, TaskPaymentTemplateKey };

/** La clave de origen que une la tarea que se crea con el paso que la cierra. */
export const PAYMENT_TASK_SOURCE_KEY = "payment:{{payment.id}}";

interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface TaskPaymentTemplate {
  key: TaskPaymentTemplateKey;
  name: string;
  description: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

function trigger(toStatus: string): CanvasNode {
  const config = { to_status: [toStatus] };
  // Guardado plano en el nodo (como lo hace el panel): el publicador lo copia a `triggers.config`.
  return { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "payment_status_changed", config: { ...config }, ...config } };
}

export const TASK_PAYMENT_TEMPLATES: readonly TaskPaymentTemplate[] = [
  {
    key: "task_payment_overdue",
    name: "Cobranza · Tarea al vencer un pago",
    description: "Cuando un pago pasa a vencido, deja una tarea para el vendedor de la venta. La cierra sola el flujo «Cobranza · Cerrar la tarea al cobrar».",
    nodes: [
      trigger("overdue"),
      {
        id: "create-task",
        type: "action",
        position: { x: 0, y: 160 },
        data: {
          actionType: "create_task",
          title: "Cobrar cuota de {{contact.first_name}} · {{sale.product_name}}",
          description: "Pago de {{payment.amount}} con vencimiento el {{payment.due_date}}.\nProducto: {{sale.product_name}}.",
          owner: "seller",
          dueMode: "days",
          dueDays: 0,
          priority: "high",
          project: "Cobranza",
          sourceKey: PAYMENT_TASK_SOURCE_KEY,
        },
      },
    ],
    edges: [{ id: "trigger-create-task", source: "trigger", target: "create-task" }],
  },
  {
    key: "task_payment_paid_close",
    name: "Cobranza · Cerrar la tarea al cobrar",
    description: "Cuando un pago se cobra, completa la tarea de cobranza que se había creado cuando venció.",
    nodes: [
      trigger("paid"),
      {
        id: "complete-task",
        type: "action",
        position: { x: 0, y: 160 },
        data: { actionType: "complete_task", sourceKey: PAYMENT_TASK_SOURCE_KEY },
      },
    ],
    edges: [{ id: "trigger-complete-task", source: "trigger", target: "complete-task" }],
  },
];

export function taskPaymentTemplateByKey(key: string): TaskPaymentTemplate | undefined {
  return TASK_PAYMENT_TEMPLATES.find((t) => t.key === key);
}

/**
 * Lo que tiene que cumplir el grafo de un flujo para publicarlo (el editor no valida nada estructural en los flujos de un
 * contacto, asi que se comprueba aca): hay un disparador que el registro conoce y se guarda, y cada paso es un nodo
 * registrado. Devuelve los problemas, o `[]`. Puro.
 */
export function taskFlowProblems(nodes: unknown[], edges: unknown[]): string[] {
  const problems: string[] = [];
  const list = nodes as Array<{ id?: string; type?: string; data?: Record<string, unknown> }>;
  const triggers = list.filter((n) => n?.type === "trigger");
  if (triggers.length !== 1) problems.push("El flujo tiene que tener un solo disparador.");
  const registered = new Set(listTriggers().map((t) => t.type as string));
  for (const t of triggers) {
    const type = (t.data as { triggerType?: unknown } | undefined)?.triggerType;
    if (typeof type !== "string" || !registered.has(type)) problems.push("El disparador no existe.");
  }
  if (triggers.length === 1 && buildDesiredTriggers(list as Array<Record<string, unknown>>, "check").length === 0) problems.push("El disparador no se puede guardar.");
  const ids = new Set(list.map((n) => n?.id));
  for (const n of list) {
    if (n?.type === "trigger") continue;
    if (!resolveNodeType(n as never)) problems.push(`El paso «${n?.id ?? "?"}» no es un tipo de paso conocido.`);
  }
  for (const e of edges as Array<{ source?: string; target?: string }>) {
    if (!ids.has(e?.source) || !ids.has(e?.target)) problems.push("Hay una conexión a un paso que no existe.");
  }
  if (list.length > 1 && (edges as unknown[]).length === 0) problems.push("Los pasos no están conectados al disparador.");
  return problems;
}

/** Lee el estado del interruptor: de los flujos, no de una columna. Sin flujos publicados, apagado. */
export async function getPaymentTasksState(db: Db, workspaceId: string): Promise<TaskPaymentState> {
  const { data } = await db.from("flows").select("id, name, status, template_key").eq("workspace_id", workspaceId).in("template_key", [...TASK_PAYMENT_TEMPLATE_KEYS]);
  const flows = ((data ?? []) as Array<{ id: string; name: string; status: string; template_key: string | null }>)
    .filter((f): f is typeof f & { template_key: TaskPaymentTemplateKey } => !!f.template_key && TASK_PAYMENT_TEMPLATE_KEYS.includes(f.template_key as TaskPaymentTemplateKey))
    .map((f) => ({ key: f.template_key, id: f.id, name: f.name, status: f.status }))
    .sort((a, b) => TASK_PAYMENT_TEMPLATE_KEYS.indexOf(a.key) - TASK_PAYMENT_TEMPLATE_KEYS.indexOf(b.key));
  return { enabled: flows.some((f) => f.key === "task_payment_overdue" && f.status === "published"), flows };
}

export type EnsureTaskPaymentResult =
  | { ok: true; state: TaskPaymentState }
  | { ok: false; error: string; state: TaskPaymentState };

/**
 * Prende o apaga la cobranza con tareas.
 *
 *  - `enabled: true`: crea (si faltan) y publica los dos flujos. Si publicar alguno falla (validacion), los DOS quedan en
 *    borrador: nunca un estado a medias. Un flujo que la persona ya edito se publica tal cual esta.
 *  - `enabled: false`: los pasa a borrador (no los borra). Las tareas ya creadas quedan.
 *
 * `db` escribe los flujos y los disparadores (cliente de servicio). Nunca lanza.
 */
export async function ensureTaskPaymentFlows(
  db: Db,
  workspaceId: string,
  options: { enabled: boolean; userId?: string | null },
): Promise<EnsureTaskPaymentResult> {
  try {
    const existing = await getPaymentTasksState(db, workspaceId);

    if (!options.enabled) {
      let failed = false;
      for (const flow of existing.flows) {
        if (flow.status !== "published") continue;
        if (!(await unpublishFlow(db, workspaceId, flow.id))) failed = true;
      }
      const state = await getPaymentTasksState(db, workspaceId);
      return failed ? { ok: false, error: "No pude apagar todos los flujos. Probá de nuevo.", state } : { ok: true, state };
    }

    // Crear los que faltan (en borrador); un flujo existente no se toca.
    const have = new Set(existing.flows.map((f) => f.key));
    const missing = TASK_PAYMENT_TEMPLATES.filter((t) => !have.has(t.key));
    if (missing.length > 0) {
      const { error } = await db.from("flows").insert(
        missing.map((t) => ({
          workspace_id: workspaceId,
          name: t.name,
          description: t.description,
          status: "draft" as const,
          nodes: t.nodes as unknown as Json,
          edges: t.edges as unknown as Json,
          template_key: t.key,
        })),
      );
      if (error) {
        console.error("[tareas] no pude crear los flujos de cobranza con tareas:", error.message);
        return { ok: false, error: "No pude crear los flujos. Probá de nuevo.", state: await getPaymentTasksState(db, workspaceId) };
      }
    }

    // Publicar los dos. Si uno falla, los dos vuelven a borrador.
    const current = await getPaymentTasksState(db, workspaceId);
    const published: string[] = [];
    for (const flow of current.flows) {
      if (flow.status === "published") continue;
      const res = await publishFlow({ db, userId: options.userId ?? null, workspaceId, flowId: flow.id, getServiceClient: async () => db, extraProblems: taskFlowProblems });
      if (!res.ok) {
        for (const id of [...published, flow.id]) await unpublishFlow(db, workspaceId, id);
        for (const other of current.flows) if (other.status === "published") await unpublishFlow(db, workspaceId, other.id);
        return { ok: false, error: `No pude publicar «${flow.name}»: ${res.error}`, state: await getPaymentTasksState(db, workspaceId) };
      }
      published.push(flow.id);
    }
    return { ok: true, state: await getPaymentTasksState(db, workspaceId) };
  } catch (error) {
    console.error("[tareas] los flujos de cobranza con tareas fallaron:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Algo salió mal. Probá de nuevo.", state: { enabled: false, flows: [] } };
  }
}
