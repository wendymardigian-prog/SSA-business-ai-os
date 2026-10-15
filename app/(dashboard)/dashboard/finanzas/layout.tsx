import { FinanceTabsProvider } from "@/components/finance/finance-tabs";
import { requireAnyPermission } from "@/lib/auth/guards";
import { FINANCE_ENTRY_PERMISSIONS, visibleFinanceTabs } from "@/lib/finance/tabs";

/**
 * Finanzas. Se entra con `expenses.view` o `commissions.view` (si no, redirige). Las pestañas que ve cada persona salen de
 * `visibleFinanceTabs`; cada pantalla las dibuja en su barra superior. La configuración no tiene pestaña propia:
 * vive en Ajustes > General > Finanzas.
 */
export default async function FinanzasLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAnyPermission(FINANCE_ENTRY_PERMISSIONS);
  const tabs = visibleFinanceTabs(ctx.can).map(({ id, name, href }) => ({ id, name, href }));
  return <FinanceTabsProvider tabs={tabs}>{children}</FinanceTabsProvider>;
}
