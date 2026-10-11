/**
 * Los recordatorios relativos al vencimiento de un pago (plano F37): «X días antes» y
 * «X días después si sigue impago». En el Bloque 3 es un NO-OP: crear una venta ya lo
 * llama, y el Bloque 4 lo completa con los jobs `payment_relative_trigger`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function syncPaymentRelativeJobs(_supabase: SupabaseClient, _target: { saleId?: string; paymentId?: string }): Promise<void> {
  void _supabase;
  void _target;
}
