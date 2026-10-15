import { NextRequest, NextResponse } from "next/server";
import { getPermissionContext } from "@/lib/auth/guards";
import { parseExpenseFilters } from "@/lib/finance/expense-filters";
import { expensesToCsv } from "@/lib/finance/expenses-csv";
import { loadExpenseRowsForExport, loadVendorsLite } from "@/lib/finance/list-load";
import { financeContextOf } from "@/lib/finance/context";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { vendorLabel } from "@/lib/finance/vendors";

/**
 * Exporta los gastos a CSV (GF13), con el MISMO filtro que la lista (la URL). Pide `expenses.view`; sin esa clave,
 * 403 y no se lee nada. Hasta 5.000 filas. NO lleva los datos de pago del proveedor.
 */
export async function GET(request: NextRequest) {
  const ctx = await getPermissionContext();
  if (!ctx.can("expenses.view")) return NextResponse.json({ error: "No tenés permiso para ver los gastos" }, { status: 403 });

  const filters = parseExpenseFilters(request.nextUrl.searchParams);
  const [{ rows, truncated }, vendors, members] = await Promise.all([loadExpenseRowsForExport(ctx, filters), loadVendorsLite(ctx), getWorkspaceMembers(ctx.workspace.id)]);
  const f = financeContextOf(ctx);
  const memberById = new Map(members.map((m) => [m.userId, m.name]));

  const csv = expensesToCsv(rows, {
    categories: f.settings.expense_categories,
    vendorName: (id) => (id ? vendorLabel(vendors, id) : ""),
    memberName: (id) => (id ? (memberById.get(id) ?? "") : ""),
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gastos-${f.todayLocal}.csv"`,
      "Cache-Control": "no-store",
      ...(truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
