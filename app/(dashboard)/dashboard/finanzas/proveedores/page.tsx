import { VendorsList, type VendorListItem } from "@/components/finance/vendors-list";
import { requirePermission } from "@/lib/auth/guards";
import { financeContextOf } from "@/lib/finance/context";
import { loadVendorTotals } from "@/lib/finance/totals-load";
import { NO_TOTALS, type VendorRow } from "@/lib/finance/vendor-totals";

export const dynamic = "force-dynamic";

const COLUMNS = "id, name, country, email, payment_details, terms, notes, user_id, archived_at";

/**
 * Finanzas > Proveedores. Lee con la sesión de quien mira (la RLS, `expenses.view`, decide). Los totales pagados se
 * suman en el servidor, en céntimos, sobre los gastos pagados de cada proveedor.
 */
export default async function ProveedoresPage() {
  const ctx = await requirePermission("expenses.view");
  const { supabase, workspace } = ctx;
  const f = financeContextOf(ctx);

  const [vendorsRes, totalsRes, templatesRes] = await Promise.all([
    supabase.from("vendors").select(COLUMNS).eq("workspace_id", workspace.id).order("name", { ascending: true }).limit(2000),
    loadVendorTotals(supabase, workspace.id, f.todayLocal),
    // Las plantillas activas por proveedor: archivar uno que se usa pide confirmación.
    supabase.from("recurring_expenses").select("vendor_id, concept").eq("workspace_id", workspace.id).eq("is_active", true).not("vendor_id", "is", null).limit(2000),
  ]);

  const vendors: VendorListItem[] = ((vendorsRes.data ?? []) as unknown as VendorRow[]).map((v) => ({ ...v, ...(totalsRes.totals.get(v.id) ?? NO_TOTALS) }));
  const templatesByVendor: Record<string, string[]> = {};
  for (const t of (templatesRes.data ?? []) as Array<{ vendor_id: string; concept: string }>) (templatesByVendor[t.vendor_id] ??= []).push(t.concept);

  return (
    <VendorsList
      vendors={vendors}
      templatesByVendor={templatesByVendor}
      canManage={ctx.can("expenses.manage")}
      loadError={!!vendorsRes.error}
      totalsFailed={totalsRes.failed}
      totalsTruncated={totalsRes.truncated}
    />
  );
}
