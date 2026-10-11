import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { can, systemRolePermissions } from "@/lib/auth/permissions";
import { isPaymentMethodKey, scheduledUsingDisabled } from "@/lib/sales/payment-methods";
import { PAYMENT_METHOD_KEYS } from "@/lib/sales/payment-methods";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // La configuracion del workspace (nombre, keywords) es de Owner/Admin.
  // Las API keys viven en /dashboard/settings/integrations.
  const { workspace, role, supabase } = await requireWorkspaceAdmin();
  const enabledMethods = (workspace.enabled_payment_methods ?? PAYMENT_METHOD_KEYS).filter(isPaymentMethodKey);
  // Los pagos programados o morosos que ya usan un metodo que se apago (el aviso de Ajustes > Ventas).
  const { data: openPayments } = await supabase.from("payments").select("payment_method").eq("workspace_id", workspace.id).in("status", ["scheduled", "overdue"]).not("payment_method", "is", null).limit(5000);
  const w = workspace as unknown as { max_discount_percent?: number | null; overdue_grace_days?: number | null; sales_auto_create_flows?: boolean | null };

  // S7: el link a Corridas se gatea por ai_costs.view, no por ser admin.
  // Hoy el guard de esta pagina ya exige Owner/Admin (los dos la tienen), asi
  // que el chequeo siempre da true acá; queda hecho bien para cuando cambie.
  const canViewAiCosts = can(systemRolePermissions(role), "ai_costs.view");

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
    />
  );
}
