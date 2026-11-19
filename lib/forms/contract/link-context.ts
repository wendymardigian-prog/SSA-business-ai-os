/**
 * Los datos de un link firmado YA verificado para las variables del contrato (`{{contacto.*}}`, `{{venta.*}}`). SOLO
 * servidor: lee con el cliente de servicio, filtrando SIEMPRE por el workspace del formulario. La venta solo cuenta si
 * es de ese mismo contacto (la misma regla que `submit_form_response` usa para el `sale_id`).
 *
 * Los pagos (`{{venta.plan_pagos}}`) se leen solo si la venta es válida. Un error al leerlos deja la variable en «—»:
 * nunca frena la firma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { contractLinkValues, type ContractPayment } from "@/lib/sales/contract";
import type { ContractLinkContext } from "./variables";

type Db = SupabaseClient<Database>;

async function loadSalePayments(service: Db, workspaceId: string, saleId: string): Promise<ContractPayment[] | null> {
  try {
    const { data, error } = await service
      .from("payments")
      .select("type, status, amount, due_date, paid_on, paid_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("sale_id", saleId);
    if (error) {
      console.error("[contract] no se pudieron leer los pagos de la venta");
      return null;
    }
    return (data ?? []) as ContractPayment[];
  } catch {
    console.error("[contract] no se pudieron leer los pagos de la venta");
    return null;
  }
}

export async function loadContractLinkContext(
  service: Db,
  workspaceId: string,
  link: { contactId: string; saleId: string | null },
): Promise<ContractLinkContext> {
  const [{ data: contact }, { data: sale }, { data: workspace }] = await Promise.all([
    service.from("contacts").select("display_name, email, phone").eq("id", link.contactId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle(),
    link.saleId
      ? service
          .from("sales")
          .select("product_snapshot, final_amount, service_starts_at")
          .eq("id", link.saleId)
          .eq("workspace_id", workspaceId)
          .eq("contact_id", link.contactId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    service.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle(),
  ]);
  const payments = sale && link.saleId ? await loadSalePayments(service, workspaceId, link.saleId) : undefined;
  return contractLinkValues(sale ? { ...sale, payments } : null, contact ?? null, workspace?.timezone || "UTC");
}
