import { redirect } from "next/navigation";
import { aiLanguageStyle } from "@/lib/ai/language-style";
import { getPermissionContext, requireAnyPermission } from "@/lib/auth/guards";
import { canOpenGeneral } from "@/lib/settings/general-sections";
import { visibleSettingsTabs } from "@/lib/settings/tabs";
import { scheduledUsingDisabled } from "@/lib/sales/payment-methods";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { createServiceClient } from "@/lib/supabase/server";
import { getPaymentTasksState } from "@/lib/tasks/automation-templates";
import { financeContextOf } from "@/lib/finance/context";
import { loadCategoryUsage } from "@/lib/finance/totals-load";
import { loadFinanceAuto } from "@/lib/finance/auto-card-load";
import { parseAttributionSettings } from "@/lib/attribution/settings";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // General se parte por permiso: «General» (`settings.general`), «Ventas y cobranza» (`sales.settings`) y «Finanzas»
  // (`expenses.manage`). Quien tiene otra pestaña de Ajustes pero ninguna de estas aterriza en esa pestaña, no en el dashboard.
  const first = await getPermissionContext();
  if (!canOpenGeneral(first.can)) {
    redirect(visibleSettingsTabs(first.can).find((tab) => tab.href !== "/dashboard/settings")?.href ?? "/dashboard");
  }
  const ctx = await requireAnyPermission(["settings.general", "sales.settings", "expenses.manage"]);
  const { workspace, supabase, can } = ctx;
  const methods = workspaceMethods(workspace);
  // Los pagos programados o morosos que ya usan un metodo que se apago (el aviso de Ajustes > Ventas).
  const { data: openPayments } = await supabase.from("payments").select("payment_method").eq("workspace_id", workspace.id).in("status", ["scheduled", "overdue"]).not("payment_method", "is", null).limit(5000);
  const w = workspace as unknown as { max_discount_percent?: number | null; overdue_grace_days?: number | null; sales_auto_create_flows?: boolean | null };

  // S7: el link a Corridas se gatea por ai_costs.view, y el de Actividad por audit.view.
  const canViewAiCosts = can("ai_costs.view");

  // «Crear una tarea cuando un pago vence» (Tareas × CRM): el estado sale de los flujos. Solo en «Ventas y cobranza».
  const canSales = can("sales.settings");
  const paymentTasks = canSales
    ? await getPaymentTasksState(await createServiceClient(), workspace.id)
    : { enabled: false, flows: [] } as unknown as Awaited<ReturnType<typeof getPaymentTasksState>>;

  // «Finanzas» (categorías de gasto): solo con `expenses.manage`. Los números de cada categoría se leen con el cliente de
  // servicio, acotado al workspace de la sesión, porque un rol que administra gastos puede no tener `expenses.view`.
  const canFinance = can("expenses.manage");
  const finance = canFinance
    ? await loadCategoryUsage(await createServiceClient(), workspace.id, financeContextOf(ctx).todayLocal)
    : { usage: {}, truncated: false, failed: false };

  // Los gastos automáticos (comisiones de procesadores, pauta de Meta, cierre del mes): también solo con `expenses.manage`.
  const financeAuto = canFinance
    ? await loadFinanceAuto(ctx)
    : { processorRows: [], metaRows: [], autoCloseDays: financeContextOf(ctx).settings.auto_close_days, vendors: [], metaFailed: false };

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
        paymentMethods: methods.configs,
        scheduledByMethod: scheduledUsingDisabled((openPayments ?? []).map((p) => p.payment_method), methods.enabledKeys),
        maxDiscountPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent),
        overdueGraceDays: Number(w.overdue_grace_days) || 0,
        salesAutoCreateFlows: w.sales_auto_create_flows !== false,
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
      financeCategories={canFinance ? financeContextOf(ctx).settings.expense_categories : []}
      financeUsage={finance.usage}
      financeUsageFailed={finance.failed}
      financeUsageTruncated={finance.truncated}
      financeAuto={financeAuto}
      paymentTasks={paymentTasks}
      attributionSettings={parseAttributionSettings((workspace as unknown as { attribution_settings?: unknown }).attribution_settings)}
    />
  );
}
