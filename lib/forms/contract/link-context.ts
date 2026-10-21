/**
 * Los datos de un link firmado YA verificado para las variables del contrato (`{{contacto.*}}`, `{{venta.*}}`). SOLO
 * servidor: lee con el cliente de servicio, filtrando SIEMPRE por el workspace del formulario. La venta solo cuenta si
 * es de ese mismo contacto (la misma regla que `submit_form_response` usa para el `sale_id`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { contractLinkValues } from "@/lib/sales/contract";
import type { ContractLinkContext } from "./variables";

type Db = SupabaseClient<Database>;

export async function loadContractLinkContext(
  service: Db,
  workspaceId: string,
  link: { contactId: string; saleId: string | null },
): Promise<ContractLinkContext> {
  const [{ data: contact }, { data: sale }] = await Promise.all([
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
  ]);
  return contractLinkValues(sale ?? null, contact ?? null);
}
