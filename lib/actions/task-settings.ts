"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureTaskPaymentFlows, getPaymentTasksState } from "@/lib/tasks/automation-templates";
import type { TaskPaymentState } from "@/lib/tasks/payment-tasks-types";

/**
 * Ajustes de Tareas del workspace. Pide `sales.settings`. En un archivo "use server" todo lo exportado es una funcion
 * asincronica; los tipos viven en `lib/tasks/automation-templates.ts`.
 */

export type PaymentTasksResult =
  | { ok: true; state: TaskPaymentState }
  | { ok: false; error: string; state: TaskPaymentState };

const NO_STATE: TaskPaymentState = { enabled: false, flows: [] };

/**
 * «Crear una tarea cuando un pago vence» (Ajustes > General > Ventas). Prendido: crea (si faltan) y publica los dos
 * flujos; apagado: los pasa a borrador (las tareas ya creadas quedan). Devuelve el estado REAL (leido de los flujos). Si
 * publicar falla, los flujos quedan en borrador, se devuelve el motivo y el interruptor queda apagado.
 */
export async function setPaymentTasksEnabled(enabled: boolean): Promise<PaymentTasksResult> {
  try {
    const ctx = await getPermissionAction("sales.settings");
    if (!ctx) return { ok: false, error: "Solo quien puede cambiar la configuración maneja este ajuste.", state: NO_STATE };
    const { workspace, user, supabase } = ctx;
    const service = await createServiceClient();

    const before = await getPaymentTasksState(service, workspace.id);
    const result = await ensureTaskPaymentFlows(service, workspace.id, { enabled: enabled === true, userId: user.id });

    if (result.state.enabled !== before.enabled) {
      await logAudit({
        supabase,
        workspaceId: workspace.id,
        entityType: "workspace",
        entityId: workspace.id,
        action: "update",
        changes: { payment_overdue_tasks: { old: before.enabled, new: result.state.enabled } },
        metadata: { section: "payment_tasks", flows: result.state.flows.map((f) => f.id) },
        performedBy: user.id,
      });
    }
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/flows");
    return result;
  } catch (error) {
    console.error("[tareas] setPaymentTasksEnabled:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Algo salió mal. Probá de nuevo.", state: NO_STATE };
  }
}
