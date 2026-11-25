"use server";
// @plantilla-quitar(servicios)

/**
 * Terminar o cambiar la serie de un paso que se repite, en UN servicio (00522). Capa fina sobre las funciones de la
 * base: ellas miran el permiso (`services.items`) y que la persona vea el servicio, con la SESIÓN. La plantilla de la
 * variante no cambia; las vueltas que ya existen tampoco.
 */
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { svcRpc, type SvcResult } from "@/lib/services/db";

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function endItemSeries(itemId: string, note: string | null): Promise<SvcResult<{ ended: boolean }>> {
  const ctx = await getPermissionAction("services.items");
  if (!ctx || !UUID.test(itemId)) return NOT_ALLOWED;
  const res = await svcRpc<{ ended: boolean }>(ctx.supabase, "svc_end_series", { p_item_id: itemId, p_note: (note ?? "").trim().slice(0, 500) || null });
  if (res.ok) revalidatePath("/dashboard/clientes", "layout");
  return res;
}

export async function changeItemSeries(itemId: string, recurrence: Record<string, unknown>): Promise<SvcResult<{ changed: boolean }>> {
  const ctx = await getPermissionAction("services.items");
  if (!ctx || !UUID.test(itemId) || !recurrence || typeof recurrence !== "object" || Array.isArray(recurrence)) return NOT_ALLOWED;
  const res = await svcRpc<{ changed: boolean }>(ctx.supabase, "svc_set_item_series", { p_item_id: itemId, p_recurrence: recurrence });
  if (res.ok) revalidatePath("/dashboard/clientes", "layout");
  return res;
}
