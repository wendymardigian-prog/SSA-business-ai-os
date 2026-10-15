import { FinanceTabsProvider } from "@/components/finance/finance-tabs";
import { requirePermission } from "@/lib/auth/guards";
import { visibleFinanceTabs } from "@/lib/finance/tabs";

/**
 * Finanzas. Sin `expenses.view` no se entra (redirige). Las pestañas que ve cada persona salen de
 * `visibleFinanceTabs`; cada pantalla las dibuja en su barra superior. La configuración no tiene pestaña propia:
 * vive en Ajustes > General > Finanzas.
 */
export default async function FinanzasLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermission("expenses.view");
  const tabs = visibleFinanceTabs(ctx.can).map(({ id, name, href }) => ({ id, name, href }));
  return <FinanceTabsProvider tabs={tabs}>{children}</FinanceTabsProvider>;
}
