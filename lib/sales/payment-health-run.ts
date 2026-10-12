/**
 * Recalcula `contacts.payment_health` (plano F31). SOLO servidor, con el cliente de servicio.
 * Se llama al cobrar, revertir o pasar a moroso, en la misma Server Action o handler. Nunca
 * lanza: un fallo acá no puede deshacer un cobro; se loguea y la próxima operación lo corrige.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { computePaymentHealth } from "./payment-health";

type Db = SupabaseClient<Database>;

export async function refreshContactPaymentHealth(service: Db, workspaceId: string, contactId: string): Promise<void> {
  try {
    const { data: sales } = await service.from("sales").select("id").eq("workspace_id", workspaceId).eq("contact_id", contactId);
    const saleIds = (sales ?? []).map((s) => s.id);
    const { data: payments } = saleIds.length
      ? await service.from("payments").select("type, status, amount, delay_days").in("sale_id", saleIds)
      : { data: [] as Array<{ type: string; status: string; amount: number; delay_days: number | null }> };
    const health = computePaymentHealth(payments ?? []);
    const { error } = await service.from("contacts").update({ payment_health: health as unknown as Json }).eq("id", contactId).eq("workspace_id", workspaceId);
    if (error) console.error("[sales] no pude actualizar la salud de pago:", error.message);
  } catch (error) {
    console.error("[sales] la salud de pago falló:", error instanceof Error ? error.message : "error");
  }
}
