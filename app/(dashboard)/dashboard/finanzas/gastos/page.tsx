import { ExpensesList } from "@/components/finance/expenses-list";
import { requirePermission } from "@/lib/auth/guards";
import { parseExpenseFilters } from "@/lib/finance/expense-filters";
import { loadExpenseList } from "@/lib/finance/list-load";

export const dynamic = "force-dynamic";

/**
 * Finanzas > Gastos. Lee con la sesión de quien mira: la RLS (`expenses.view`) decide qué ve. Todo el estado de la
 * lista (filtros, agrupar, página) vive en la URL; los totales y las pastillas los suma el servidor, en céntimos.
 */
export default async function GastosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("expenses.view");
  const filters = parseExpenseFilters(await searchParams);
  const data = await loadExpenseList(ctx, filters);
  return <ExpensesList data={data} />;
}
