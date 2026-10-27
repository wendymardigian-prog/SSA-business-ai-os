import { redirect } from "next/navigation";
import { aiLanguageStyle } from "@/lib/ai/language-style";
import { getPermissionContext, requireAnyPermission } from "@/lib/auth/guards";
import { canOpenGeneral } from "@/lib/settings/general-sections";
import { visibleSettingsTabs } from "@/lib/settings/tabs";
import { scheduledUsingDisabled } from "@/lib/sales/payment-methods"; // @plantilla-quitar(ventas)
import { workspaceMethods } from "@/lib/sales/workspace-methods"; // @plantilla-quitar(ventas)
import { createServiceClient } from "@/lib/supabase/server";
import { getPaymentTasksState } from "@/lib/tasks/automation-templates"; // @plantilla-quitar(tareas)
import { financeContextOf } from "@/lib/finance/context"; // @plantilla-quitar(finanzas)
import { loadCategoryUsage } from "@/lib/finance/totals-load"; // @plantilla-quitar(finanzas)
import { loadFinanceAuto } from "@/lib/finance/auto-card-load"; // @plantilla-quitar(finanzas)
import { parseAttributionSettings } from "@/lib/attribution/settings";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // General se parte por permiso: «General» (`settings.general`), «Ventas y cobranza» (`sales.settings`) y «Finanzas»  @plantilla-quitar(ventas,finanzas)
  // (`expenses.manage`). Quien tiene otra pestaña de Ajustes pero ninguna de estas aterriza en esa pestaña, no en el dashboard.  @plantilla-quitar(ventas,finanzas)
  // @plantilla-sin(ventas,finanzas): // «General» pide `settings.general`: quien tiene otra pestaña de Ajustes pero no esta aterriza en esa pestaña, no en el dashboard.
  const first = await getPermissionContext();
  if (!canOpenGeneral(first.can)) {
    redirect(visibleSettingsTabs(first.can).find((tab) => tab.href !== "/dashboard/settings")?.href ?? "/dashboard");
  }
  const ctx = await requireAnyPermission(["settings.general", "sales.settings", "expenses.manage"]); // @plantilla-quitar(ventas,finanzas)
  // @plantilla-sin(ventas,finanzas): const ctx = await requireAnyPermission(["settings.general"]);
  const { workspace, supabase, can } = ctx;
  const methods = workspaceMethods(workspace); // @plantilla-quitar(ventas)
  // Los pagos programados o morosos que ya usan un metodo que se apago (el aviso de Ajustes > Ventas). // @plantilla-quitar(ventas)
  const { data: openPayments } = await supabase.from("payments").select("payment_method").eq("workspace_id", workspace.id).in("status", ["scheduled", "overdue"]).not("payment_method", "is", null).limit(5000); // @plantilla-quitar(ventas)
  const w = workspace as unknown as { max_discount_percent?: number | null; overdue_grace_days?: number | null; sales_auto_create_flows?: boolean | null }; // @plantilla-quitar(ventas)

  // S7: el link a Corridas se gatea por ai_costs.view, y el de Actividad por audit.view.
  const canViewAiCosts = can("ai_costs.view");

  // «Crear una tarea cuando un pago vence» (Tareas × CRM): el estado sale de los flujos. Solo en «Ventas y cobranza». // @plantilla-quitar(ventas)
  const canSales = can("sales.settings"); // @plantilla-quitar(ventas)
  // @plantilla-sin(ventas): const canSales = false;
  // @plantilla-desde(tareas)
  const paymentTasks = canSales
    ? await getPaymentTasksState(await createServiceClient(), workspace.id)
    : { enabled: false, flows: [] } as unknown as Awaited<ReturnType<typeof getPaymentTasksState>>;
  // @plantilla-hasta(tareas)

  // «Finanzas» (categorías de gasto): solo con `expenses.manage`. Los números de cada categoría se leen con el cliente de // @plantilla-quitar(finanzas)
  // servicio, acotado al workspace de la sesión, porque un rol que administra gastos puede no tener `expenses.view`. // @plantilla-quitar(finanzas)
  const canFinance = can("expenses.manage"); // @plantilla-quitar(finanzas)
  // @plantilla-sin(finanzas): const canFinance = false;
  // @plantilla-desde(finanzas)
  const finance = canFinance
    ? await loadCategoryUsage(await createServiceClient(), workspace.id, financeContextOf(ctx).todayLocal)
    : { usage: {}, truncated: false, failed: false };
  // @plantilla-hasta(finanzas)

  // @plantilla-desde(finanzas)
  // Los gastos automáticos (comisiones de procesadores, pauta de Meta, cierre del mes): también solo con `expenses.manage`.
  const financeAuto = canFinance
    ? await loadFinanceAuto(ctx)
    : { processorRows: [], metaRows: [], autoCloseDays: financeContextOf(ctx).settings.auto_close_days, vendors: [], metaFailed: false };
  // @plantilla-hasta(finanzas)

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
        optOutPhrases: workspace.opt_out_phrases ?? [],
        persistChatMedia: workspace.persist_chat_media ?? true,
        chatMediaRetentionDays: workspace.chat_media_retention_days ?? 180,
        timezone: (workspace as { timezone?: string }).timezone ?? "UTC",
        paymentMethods: methods.configs, // @plantilla-quitar(ventas)
        scheduledByMethod: scheduledUsingDisabled((openPayments ?? []).map((p) => p.payment_method), methods.enabledKeys), // @plantilla-quitar(ventas)
        maxDiscountPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent), // @plantilla-quitar(ventas)
        overdueGraceDays: Number(w.overdue_grace_days) || 0, // @plantilla-quitar(ventas)
        salesAutoCreateFlows: w.sales_auto_create_flows !== false, // @plantilla-quitar(ventas)
        brand: {
          name: workspace.brand_name ?? null,
          logoPath: workspace.brand_logo_path ?? null,
          color: workspace.brand_color ?? null,
          languageStyle: workspace.ai_language_style ?? null,
          installationStyle: aiLanguageStyle(),
        },
      }}
      canViewAiCosts={canViewAiCosts}
      canViewAudit={can("audit.view")}
      canGeneral={can("settings.general")}
      canSales={canSales}
      canFinance={canFinance}
      financeCategories={canFinance ? financeContextOf(ctx).settings.expense_categories : []} // @plantilla-quitar(finanzas)
      financeUsage={finance.usage} // @plantilla-quitar(finanzas)
      financeUsageFailed={finance.failed} // @plantilla-quitar(finanzas)
      financeUsageTruncated={finance.truncated} // @plantilla-quitar(finanzas)
      financeAuto={financeAuto} // @plantilla-quitar(finanzas)
      paymentTasks={paymentTasks} // @plantilla-quitar(tareas)
      attributionSettings={parseAttributionSettings((workspace as unknown as { attribution_settings?: unknown }).attribution_settings)}
    />
  );
}
