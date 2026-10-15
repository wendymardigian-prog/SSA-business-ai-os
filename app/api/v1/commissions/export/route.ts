import { NextRequest, NextResponse } from "next/server";
import { getPermissionContext } from "@/lib/auth/guards";
import { commissionsToCsv } from "@/lib/commissions/export-csv";
import { parseCommissionFilters } from "@/lib/commissions/filters";
import { loadCommissionExport } from "@/lib/commissions/screen-load";
import { financeContextOf } from "@/lib/finance/context";

/**
 * Exporta las comisiones a CSV (F67), con el MISMO filtro que la lista (la URL). Pide `commissions.view` y lee con
 * la sesión de quien lo pide: con alcance `own` la RLS deja pasar solo las suyas, y lo cobrado y la comisión del
 * procesador salen vacíos. Sin la clave, 403 y no se lee nada. Hasta 5.000 filas.
 */
export async function GET(request: NextRequest) {
  const ctx = await getPermissionContext();
  if (!ctx.can("commissions.view")) return NextResponse.json({ error: "No tenés permiso para ver las comisiones" }, { status: 403 });

  const filters = parseCommissionFilters(request.nextUrl.searchParams);
  let result: Awaited<ReturnType<typeof loadCommissionExport>>;
  try {
    result = await loadCommissionExport(ctx, filters);
  } catch (e) {
    console.error("[comisiones] no pude armar el CSV:", e instanceof Error ? e.message : String(e));
    result = null;
  }
  if (!result) return NextResponse.json({ error: "No pudimos armar el CSV. Probá de nuevo." }, { status: 500 });

  const f = financeContextOf(ctx);
  return new NextResponse(commissionsToCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comisiones-${f.todayLocal}.csv"`,
      "Cache-Control": "no-store",
      ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
