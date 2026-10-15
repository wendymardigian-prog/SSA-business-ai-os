/**
 * Los totales por proveedor y por categoría (SOLO servidor). Leen TODAS las filas necesarias de a páginas y
 * suman en céntimos (`vendor-totals` y `category-totals`, puros). Quien llama ya comprobó el permiso y elige el
 * cliente: la sesión (la RLS decide) o el de servicio acotado al workspace de la sesión.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { categoryUsage, type CategoryExpenseRow, type CategoryUsage } from "./category-totals";
import { fetchAllPages } from "./paginate";
import { vendorTotals, type PaidExpenseRow, type VendorTotals } from "./vendor-totals";

type Client = PermissionContext["supabase"];

export async function loadVendorTotals(client: Client, workspaceId: string, todayLocal: string): Promise<{ totals: Map<string, VendorTotals>; truncated: boolean; failed: boolean }> {
  const { rows, truncated, error } = await fetchAllPages<PaidExpenseRow>(
    (from, to) =>
      client
        .from("expenses")
        .select("vendor_id, amount, paid_date, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "pagado")
        .not("vendor_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PaidExpenseRow[] | null; error: { message: string } | null }>,
  );
  if (error) console.error("[finance] no pude sumar los pagos por proveedor:", error);
  return { totals: vendorTotals(rows, todayLocal), truncated, failed: !!error };
}

export async function loadCategoryUsage(client: Client, workspaceId: string, todayLocal: string): Promise<{ usage: Record<string, CategoryUsage>; truncated: boolean; failed: boolean }> {
  const { rows, truncated, error } = await fetchAllPages<CategoryExpenseRow>(
    (from, to) =>
      client
        .from("expenses")
        .select("category_key, amount, status, paid_date")
        .eq("workspace_id", workspaceId)
        .neq("status", "anulado")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: CategoryExpenseRow[] | null; error: { message: string } | null }>,
  );
  if (error) console.error("[finance] no pude sumar los gastos por categoría:", error);
  return { usage: categoryUsage(rows, todayLocal), truncated, failed: !!error };
}
