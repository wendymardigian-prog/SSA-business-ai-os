/**
 * Las tres acciones de Ventas que un flujo puede hacer (plano F37).
 *
 *   mark_payment_paid    Marca como cobrado el pago que disparó el flujo (con confirmación en el editor):
 *                        método elegido y fecha del día; NO sube comprobante.
 *   reschedule_payment   Mueve el vencimiento del pago N días, con un motivo fijo.
 *   set_sale_status      Cambia el estado de la venta, SOLO a `cancelled` o `subscription_cancelled`, con motivo.
 *
 * Pasan por el MISMO núcleo que las Server Actions (`lib/sales/payments-core.ts`): la misma regla, el
 * mismo recálculo y la misma auditoría, con actor sistema y el NOMBRE DEL FLUJO como etiqueta. El pago y
 * la venta salen del contexto (`event_payment_id`, `event_sale_id`): un flujo de ventas trabaja sobre lo que
 * lo disparó. Si falta, o la acción no se puede hacer (el pago ya estaba cobrado, la venta ya cerrada), el
 * nodo avisa en el log y el flujo sigue: una acción que no corresponde no puede tumbar a las demás.
 */
import { interpolateVariables } from "../interpolate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { addDays } from "@/lib/sales/dates";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { cancelSaleAsSystem, markPaidCore, rescheduleCore, type CoreContext } from "@/lib/sales/payments-core";

type Db = SupabaseClient<Database>;

export interface MarkPaymentPaidNodeData {
  method?: string;
  /** La confirmación del editor: sin ella el nodo no cobra nada. */
  confirmed?: boolean;
}

export interface ReschedulePaymentNodeData {
  /** Días a sumar al vencimiento actual (1–90). */
  days?: number;
  reason?: string;
}

export interface SetSaleStatusNodeData {
  status?: "cancelled" | "subscription_cancelled";
  reason?: string;
}

const DEFAULT_RESCHEDULE_REASON = "Reprogramado por una automatización";

function idFrom(context: NodeExecutionArgs<unknown>["context"], key: string): string | null {
  const id = context.variables?.[key];
  return typeof id === "string" && id ? id : null;
}

/** Lo que el núcleo necesita: pago, venta, ajustes del workspace y el nombre del flujo. */
async function loadCore(db: Db, context: NodeExecutionArgs<unknown>["context"], needPayment: boolean): Promise<Omit<CoreContext, "actor"> & { flowName: string } | null> {
  const paymentId = idFrom(context, "event_payment_id");
  let saleId = idFrom(context, "event_sale_id");
  let payment = null;
  if (needPayment || paymentId) {
    if (!paymentId) return null;
    const { data } = await db
      .from("payments")
      .select("id, workspace_id, sale_id, type, status, amount, due_date, original_due_date, reschedule_count, paid_on, payment_method")
      .eq("id", paymentId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!data) return null;
    payment = data;
    saleId = saleId ?? data.sale_id;
  }
  if (!saleId) return null;
  const [{ data: sale }, { data: workspace }, { data: flow }] = await Promise.all([
    db.from("sales").select("id, contact_id, sale_date, status, financing_type").eq("id", saleId).eq("workspace_id", context.workspaceId).maybeSingle(),
    db.from("workspaces").select("timezone, payment_methods, overdue_grace_days").eq("id", context.workspaceId).maybeSingle(),
    db.from("flows").select("name").eq("id", context.flowId).maybeSingle(),
  ]);
  if (!sale) return null;
  const w = (workspace ?? {}) as { timezone?: string; overdue_grace_days?: number | null };
  const methods = workspaceMethods(workspace);
  return {
    service: db,
    workspaceId: context.workspaceId,
    payment: (payment ?? { id: "", workspace_id: context.workspaceId, sale_id: sale.id, type: "installment", status: "scheduled", amount: 0, due_date: null, original_due_date: null, reschedule_count: 0, paid_on: null, payment_method: null }) as CoreContext["payment"],
    sale,
    tz: w.timezone ?? "UTC",
    graceDays: Number(w.overdue_grace_days) || 0,
    enabledMethods: methods.enabledKeys,
    methods: methods.defs,
    flowName: flow?.name ?? "Automatización",
  };
}

export const markPaymentPaidNode: NodeDefinition<MarkPaymentPaidNodeData> = {
  needsContact: true,
  type: "mark_payment_paid",
  label: "Marcar el pago como cobrado",
  aliases: [{ nodeType: "action", actionType: "mark_payment_paid" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<MarkPaymentPaidNodeData>) {
    if (data.confirmed !== true) {
      console.warn(`[flow-engine] el nodo ${node.id} no cobra: falta la confirmación en el editor`);
      return;
    }
    const core = await loadCore(supabase, context, true);
    if (!core) {
      console.warn(`[flow-engine] el nodo ${node.id} quiere cobrar un pago y el flujo no arrancó por uno`);
      return;
    }
    const method = data.method && core.enabledMethods.includes(data.method) ? data.method : core.enabledMethods[0];
    if (!method) {
      console.warn(`[flow-engine] el nodo ${node.id} no cobra: no hay ningún método de pago habilitado`);
      return;
    }
    const { flowName, ...rest } = core;
    const result = await markPaidCore({ ...rest, actor: { kind: "system", label: flowName } }, { method });
    if (!result.ok) console.warn(`[flow-engine] no pude cobrar el pago ${core.payment.id}: ${result.error}`);
  },
};

export const reschedulePaymentNode: NodeDefinition<ReschedulePaymentNodeData> = {
  needsContact: true,
  type: "reschedule_payment",
  label: "Reprogramar el pago",
  aliases: [{ nodeType: "action", actionType: "reschedule_payment" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<ReschedulePaymentNodeData>) {
    const days = Math.floor(Number(data.days));
    if (!(days >= 1 && days <= 90)) {
      console.warn(`[flow-engine] el nodo ${node.id} no reprograma: los días a sumar tienen que ir de 1 a 90`);
      return;
    }
    const core = await loadCore(supabase, context, true);
    if (!core || !core.payment.due_date) {
      console.warn(`[flow-engine] el nodo ${node.id} quiere reprogramar un pago y el flujo no arrancó por uno`);
      return;
    }
    const { flowName, ...rest } = core;
    const result = await rescheduleCore(
      { ...rest, actor: { kind: "system", label: flowName } },
      { newDate: addDays(core.payment.due_date, days), reason: interpolateVariables(data.reason ?? "", context.variables ?? {}).trim() || DEFAULT_RESCHEDULE_REASON },
    );
    if (!result.ok) console.warn(`[flow-engine] no pude reprogramar el pago ${core.payment.id}: ${result.error}`);
  },
};

export const setSaleStatusNode: NodeDefinition<SetSaleStatusNodeData> = {
  needsContact: true,
  type: "set_sale_status",
  label: "Cambiar el estado de la venta",
  aliases: [{ nodeType: "action", actionType: "set_sale_status" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<SetSaleStatusNodeData>) {
    // Solo dos destinos: cancelar es definitivo y la baja de una suscripción también; el resto del estado se deriva de los pagos.
    if (data.status !== "cancelled" && data.status !== "subscription_cancelled") {
      console.warn(`[flow-engine] el nodo ${node.id} no cambia la venta: solo puede ir a cancelada o a suscripción dada de baja`);
      return;
    }
    const core = await loadCore(supabase, context, false);
    if (!core) {
      console.warn(`[flow-engine] el nodo ${node.id} quiere cambiar una venta y el flujo no arrancó por una`);
      return;
    }
    const { flowName, payment: _payment, ...rest } = core;
    void _payment;
    const result = await cancelSaleAsSystem({ ...rest, actor: { kind: "system", label: flowName } }, { to: data.status, reason: interpolateVariables(data.reason ?? "", context.variables ?? {}).trim() || "Cambiado por una automatización" });
    if (!result.ok) console.warn(`[flow-engine] no pude cambiar la venta ${core.sale.id}: ${result.error}`);
  },
};
