// @plantilla-quitar(ventas)
/**
 * La venta hereda el afiliado del contacto (F74): segundo paso DESPUÉS de `create_sale` (que está protegida y no se
 * toca). Si el contacto tiene un afiliado vigente (sin vencer), la venta queda con él y su tipo. Lo escribe el servidor
 * con `affiliate_set_sale` (sin motivo: es el alta). Nunca lanza ni tumba la venta: un fallo se anota y la venta queda
 * sin afiliado (se puede asignar a mano desde la ficha).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, any, any>;

export function vigenteAffiliate(row: { affiliate_user_id: string | null; affiliate_contact_id: string | null; affiliate_kind: string | null; affiliate_expires_at: string | null } | null, now: Date) {
  if (!row) return null;
  if (row.affiliate_expires_at && Date.parse(row.affiliate_expires_at) < now.getTime()) return null;
  if (row.affiliate_user_id) return { ref: { type: "user" as const, id: row.affiliate_user_id }, kind: row.affiliate_kind ?? "influenced" };
  if (row.affiliate_contact_id) return { ref: { type: "contact" as const, id: row.affiliate_contact_id }, kind: row.affiliate_kind ?? "influenced" };
  return null;
}

export async function inheritContactAffiliate(service: Db, workspaceId: string, saleId: string, contactId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { data } = await service
      .from("contacts")
      .select("affiliate_user_id, affiliate_contact_id, affiliate_kind, affiliate_expires_at")
      .eq("workspace_id", workspaceId)
      .eq("id", contactId)
      .maybeSingle();
    const pick = vigenteAffiliate(data as never, now);
    if (!pick) return false;
    const { error } = await service.rpc("affiliate_set_sale", { p_sale_id: saleId, p_affiliate: pick.ref, p_kind: pick.kind, p_reason: null });
    if (error) {
      console.error("[afiliados] no pude pasar el afiliado del contacto a la venta:", error.code ?? "?");
      return false;
    }
    return true;
  } catch (err) {
    console.error("[afiliados] no pude pasar el afiliado del contacto a la venta:", err instanceof Error ? err.name : "error");
    return false;
  }
}
