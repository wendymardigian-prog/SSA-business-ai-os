/**
 * Lo que necesita la tarjeta «Gastos automáticos» de Ajustes (SOLO servidor): los métodos de pago del negocio, las
 * cuentas de Meta, los proveedores activos y lo guardado. Quien llama ya chequeó `expenses.manage` y pasa el
 * workspace de la SESIÓN. Lee con el cliente de servicio porque un rol que administra gastos puede no tener
 * `expenses.view` (mismo criterio que los números de las categorías).
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { buildMetaRows, buildProcessorRows, type FinanceAutoData } from "./auto-card";
import { financeContextOf } from "./context";
import { loadMetaAccounts } from "./meta-accounts";

export async function loadFinanceAuto(ctx: Pick<PermissionContext, "workspace">): Promise<FinanceAutoData> {
  const workspaceId = ctx.workspace.id;
  const settings = financeContextOf(ctx).settings;
  const methods = workspaceMethods(ctx.workspace).configs;

  let metaFailed = false;
  const [accounts, vendors] = await Promise.all([
    loadMetaAccounts(workspaceId).catch((e: unknown) => {
      metaFailed = true;
      console.error("[finanzas] no pude leer las cuentas de Meta:", e instanceof Error ? e.message : String(e));
      return [];
    }),
    createServiceClient()
      .then((service) => service.from("vendors").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name", { ascending: true }).limit(2000))
      .then((r) => ((r.data ?? []) as Array<{ id: string; name: string }>))
      .catch((e: unknown) => {
        console.error("[finanzas] no pude leer los proveedores:", e instanceof Error ? e.message : String(e));
        return [] as Array<{ id: string; name: string }>;
      }),
  ]);

  return {
    processorRows: buildProcessorRows(methods, settings.processor_fees),
    metaRows: buildMetaRows(accounts, settings.meta_ads),
    autoCloseDays: settings.auto_close_days,
    vendors,
    metaFailed,
  };
}
