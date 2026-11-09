"use server";
// @plantilla-quitar(comisiones)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { buildCommissionEdit, type CommissionEditForm } from "@/lib/commissions/edit";
import { commissionDbError } from "@/lib/commissions/errors";

/**
 * Editar una comisión a mano (F107). `commission_edit` (00343) corre solo con el cliente de servicio: la guardia de
 * `commissions` (CM003) no deja escribir a una sesión y la marca interna la pone solo la liquidación. Por eso el
 * permiso (`commissions.edit`) y el negocio se miran acá, antes de llamar, y la comisión se busca por el workspace
 * de la sesión. La función anula la vieja y crea la nueva con `edited_manually`, y deja las dos en el historial.
 */
export async function editCommission(commissionId: string, form: CommissionEditForm): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("commissions.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar comisiones" };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("commissions")
    .select("id, expense_id, voided_at, amount, role, user_id, contact_id")
    .eq("id", commissionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "No encontré esa comisión" };
  const row = data as unknown as { expense_id: string | null; voided_at: string | null; amount: number; role: string | null; user_id: string | null; contact_id: string | null };
  const built = buildCommissionEdit(
    { expenseId: row.expense_id, voidedAt: row.voided_at, amount: Number(row.amount), role: row.role, userId: row.user_id, contactId: row.contact_id },
    form,
  );
  if (!built.ok) return built;
  if (built.patch.void === false && built.patch.user_id) {
    const { data: m } = await service.from("workspace_members").select("user_id").eq("workspace_id", ctx.workspace.id).eq("user_id", built.patch.user_id).maybeSingle();
    if (!m) return { ok: false, error: "Esa persona no es del equipo" };
  }
  if (built.patch.void === false && built.patch.contact_id) {
    const { data: c } = await service.from("contacts").select("id").eq("workspace_id", ctx.workspace.id).eq("id", built.patch.contact_id).is("deleted_at", null).maybeSingle();
    if (!c) return { ok: false, error: "No encontré ese contacto" };
  }
  const { data: newId, error: rpcError } = await (service as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> }).rpc(
    "commission_edit",
    { p_commission_id: commissionId, p_patch: built.patch, p_reason: built.reason, p_actor: ctx.user.id },
  );
  if (rpcError) {
    console.error("[comisiones] commission_edit fallo:", rpcError.code ?? "sin codigo");
    return { ok: false, error: /^CM02\d$/.test(rpcError.code ?? "") && rpcError.message ? rpcError.message : commissionDbError(rpcError, "No se pudo editar la comisión. Probá de nuevo en un rato.") };
  }
  revalidatePath("/dashboard/finanzas/comisiones");
  return { ok: true, id: (newId as string | null) ?? null };
}
