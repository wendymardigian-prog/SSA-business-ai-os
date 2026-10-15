import { SummaryDashboard } from "@/components/finance/summary-dashboard";
import { requirePermission } from "@/lib/auth/guards";
import { loadFinanceDashboard } from "@/lib/finance/dashboard-load";

export const dynamic = "force-dynamic";

/**
 * Finanzas > Resumen: cuánto entra, cuánto sale y cuánto queda. Pide `expenses.view`. Los pagos y las ventas se
 * leen en el servidor y solo viajan sus totales (ver `dashboard-load.ts`).
 */
export default async function FinanzasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("expenses.view");
  const data = await loadFinanceDashboard(ctx, await searchParams);
  return <SummaryDashboard data={data} />;
}
