import { redirect } from "next/navigation";
import { SummaryDashboard } from "@/components/finance/summary-dashboard";
import { requireAnyPermission } from "@/lib/auth/guards";
import { loadFinanceDashboard } from "@/lib/finance/dashboard-load";
import { FINANCE_ENTRY_PERMISSIONS, financeEntryHref } from "@/lib/finance/tabs";

export const dynamic = "force-dynamic";

/**
 * Finanzas > Resumen: cuánto entra, cuánto sale y cuánto queda. Pide `expenses.view`: quien entra a Finanzas solo con `commissions.view` va a la primera pestaña que ve (o a `/dashboard`). Los pagos y las ventas se
 * leen en el servidor y solo viajan sus totales (ver `dashboard-load.ts`).
 */
export default async function FinanzasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAnyPermission(FINANCE_ENTRY_PERMISSIONS);
  if (!ctx.can("expenses.view")) redirect(financeEntryHref(ctx.can) ?? "/dashboard");
  const data = await loadFinanceDashboard(ctx, await searchParams);
  return <SummaryDashboard data={data} />;
}
