"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { applyRevert, type AuditEntry } from "@/lib/agent/revert";

/**
 * Revertir una accion del agente desde la pestana Acciones (F28).
 *
 * Tres pasos, con dos clientes a proposito:
 *   1. Leer el asiento con el cliente del usuario: si la RLS no se lo muestra
 *      (lead fuera de su scope), no existe para el.
 *   2. Aplicar el inverso con ese mismo cliente y dejar la entrada `revert`
 *      firmada por el (lib/agent/revert.ts).
 *   3. Marcar el asiento original como revertido con service role: audit_log
 *      no tiene policy de UPDATE, asi nadie desmarca una reversion a mano.
 */
export async function revertAgentAction(auditId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof auditId !== "string" || !auditId) return { ok: false, error: "Pedido invalido." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesion vencio. Volve a entrar." };

  const { data: entry } = await supabase
    .from("audit_log")
    .select("id, workspace_id, entity_type, entity_id, action, changes, metadata, performed_by_agent_id, reverted_at")
    .eq("id", auditId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "No encontre esa accion o no esta a tu alcance." };
  if (!entry.performed_by_agent_id) return { ok: false, error: "Solo se revierten acciones del agente." };
  if (entry.reverted_at) return { ok: false, error: "Esa accion ya fue revertida." };

  const result = await applyRevert(supabase, entry as AuditEntry, { userId: user.id });
  if (!result.ok) return result;

  const service = await createServiceClient();
  const { error } = await service
    .from("audit_log")
    .update({ reverted_at: new Date().toISOString(), reverted_by_audit_id: result.revertAuditId })
    .eq("id", entry.id)
    .is("reverted_at", null);
  if (error) console.error("[agent-actions] no pude marcar la reversion:", error.message);

  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
