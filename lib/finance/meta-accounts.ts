/**
 * Las cuentas publicitarias de la integración de Meta de UN workspace, para la configuración de los gastos
 * automáticos. SOLO servidor: lee con el cliente de servicio, así que quien llama ya chequeó el permiso y pasa el
 * workspace de la SESIÓN (nunca uno que venga del navegador). No es una Server Action a propósito.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { parseMetaConfig } from "@/lib/meta/accounts";

export interface MetaAccountLite {
  id: string;
  name: string;
  currency: string | null;
}

export async function loadMetaAccounts(workspaceId: string): Promise<MetaAccountLite[]> {
  const service = await createServiceClient();
  const { data } = await service.from("integration_configs").select("config").eq("workspace_id", workspaceId).eq("type", "meta").limit(1).maybeSingle();
  return parseMetaConfig((data as { config?: unknown } | null)?.config).ad_accounts.map((a) => ({ id: a.ad_account_id, name: a.name ?? a.ad_account_id, currency: a.currency ?? null }));
}
