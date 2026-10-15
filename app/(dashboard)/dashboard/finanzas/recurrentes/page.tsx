import { RecurringList } from "@/components/finance/recurring-list";
import { requirePermission } from "@/lib/auth/guards";
import { loadRecurringScreen } from "@/lib/finance/recurring-load";
import { parseEstadoFilter } from "@/lib/finance/recurring-list";

export const dynamic = "force-dynamic";

/**
 * Finanzas > Recurrentes. Lee con la sesión de quien mira (la RLS, `expenses.view`, decide). El filtro de estado
 * vive en la URL (`?estado=`); el resumen «Equivale a USD X por mes» suma siempre todas las activas.
 */
export default async function RecurrentesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("expenses.view");
  const estado = parseEstadoFilter((await searchParams).estado);
  const data = await loadRecurringScreen(ctx, estado);
  return <RecurringList data={data} />;
}
