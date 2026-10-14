import { redirect } from "next/navigation";
import { getPermissionContext, requireAnyPermission } from "@/lib/auth/guards";
import { canOpenGeneral } from "@/lib/settings/general-sections";
import { visibleSettingsTabs } from "@/lib/settings/tabs";
import { isPaymentMethodKey, scheduledUsingDisabled } from "@/lib/sales/payment-methods";
import { PAYMENT_METHOD_KEYS } from "@/lib/sales/payment-methods";
import { createServiceClient } from "@/lib/supabase/server";
import { getPaymentTasksState } from "@/lib/tasks/automation-templates";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // General se parte en dos por permiso: «General» (`settings.general`) y «Ventas y cobranza` (`sales.settings`).
  // Quien tiene otra pestaña de Ajustes pero ninguna de estas dos aterriza en esa pestaña, no en el dashboard.
  const first = await getPermissionContext();
  if (!canOpenGeneral(first.can)) {
    redirect(visibleSettingsTabs(first.can).find((tab) => tab.href !== "/dashboard/settings")?.href ?? "/dashboard");
  }
  const { workspace, supabase, can } = await requireAnyPermission(["settings.general", "sales.settings"]);
  const enabledMethods = (workspace.enabled_payment_methods ?? PAYMENT_METHOD_KEYS).filter(isPaymentMethodKey);
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
        enabledPaymentMethods: enabledMethods,
        scheduledByMethod: scheduledUsingDisabled((openPayments ?? []).map((p) => p.payment_method), enabledMethods),
        maxDiscountPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent),
        overdueGraceDays: Number(w.overdue_grace_days) || 0,
        salesAutoCreateFlows: w.sales_auto_create_flows !== false,
      }}
      canViewAiCosts={canViewAiCosts}
      canViewAudit={can("audit.view")}
      canGeneral={can("settings.general")}
      canSales={canSales}
      paymentTasks={paymentTasks}
    />
  );
}
