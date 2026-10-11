import { SalesList, type SalesListData } from "@/components/sales/sales-list";
import { requirePermission } from "@/lib/auth/guards";
import { localToday, addDays } from "@/lib/sales/dates";
import { PILL_STATUSES, SALES_PAGE_SIZE, parseSalesFilters, saleListRow, salesQueryFilters, type QueryFilter } from "@/lib/sales/list";
import { loadWizardConfig, hasSalesAllScope } from "@/lib/sales/wizard/load";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { sanitizeSearch } from "@/lib/url-params";
import { ensureSalesTemplateFlows } from "@/lib/sales/automation/templates-run";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const COLUMNS = "id, contact_id, sale_date, status, final_amount, product_snapshot, attribution, attribution_type, vendedor_id, setter_id";

/**
 * La lista de ventas (F25). Lee con el cliente del usuario: la RLS (`can_see_sale`) decide qué ve
 * cada quien; un Member con alcance `own` ve solo las suyas aunque la URL pida otro vendedor.
 * Los filtros viven en la URL y se aplican EN LA CONSULTA, nunca en memoria.
 */
export default async function VentasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("sales.view");
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const filters = parseSalesFilters(sp);
  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const today = localToday(new Date(), workspace.timezone);

  // Los cuatro flujos de cobranza (apagados) se crean la primera vez que un Owner o Admin abre Ventas; es idempotente
  // y respeta la opcion de Ajustes. No hay backfill durante el deploy.
  if (ctx.role === "owner" || ctx.role === "admin") await ensureSalesTemplateFlows(await createServiceClient(), workspace.id);

  // «Por cobrar esta semana»: ventas con algún pago programado que vence en los próximos 7 días.
  const weekEnd = addDays(today, 7);
  const dueSoon = await supabase.from("payments").select("sale_id").eq("workspace_id", workspace.id).eq("status", "scheduled").gte("due_date", today).lte("due_date", weekEnd).limit(1000);
  const dueSoonIds = [...new Set((dueSoon.data ?? []).map((p) => p.sale_id))];

  // La búsqueda mira los contactos que coinciden (los que esta persona ve).
  let contactIds: string[] | null = null;
  if (filters.q) {
    const q = sanitizeSearch(filters.q, 60);
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(50);
    contactIds = (data ?? []).map((c) => c.id);
  }

  const from = (filters.page - 1) * SALES_PAGE_SIZE;
  let query = supabase.from("sales").select(COLUMNS, { count: "exact" }).eq("workspace_id", workspace.id);
  for (const f of salesQueryFilters(filters) as QueryFilter[]) {
    if (f.op === "eq") query = query.eq(f.column, f.value as string);
    else if (f.op === "in") query = query.in(f.column, f.value as string[]);
    else if (f.op === "gte") query = query.gte(f.column, f.value as string);
    else if (f.op === "lte") query = query.lte(f.column, f.value as string);
    else query = query.ilike(f.column, f.value as string);
  }
  if (filters.pill === "esta_semana") query = query.in("id", dueSoonIds.length ? dueSoonIds : ["00000000-0000-0000-0000-000000000000"]);
  if (contactIds) query = query.in("contact_id", contactIds.length ? contactIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, count, error } = await query.order("sale_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + SALES_PAGE_SIZE - 1);

  const sales = data ?? [];
  const saleIds = sales.map((s) => s.id);
  const [payments, contacts, members, config, anySale, ...pillCounts] = await Promise.all([
    saleIds.length ? supabase.from("payments").select("sale_id, amount, status").in("sale_id", saleIds) : Promise.resolve({ data: [] as Array<{ sale_id: string; amount: number; status: string }> }),
    sales.length ? supabase.from("contacts").select("id, display_name, email").in("id", [...new Set(sales.map((s) => s.contact_id))]) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }> }),
    getWorkspaceMembers(workspace.id),
    loadWizardConfig(ctx),
    supabase.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    ...(["al_dia", "con_mora", "canceladas"] as const).map((p) => supabase.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", [...PILL_STATUSES[p]] as never[])),
  ]);

  const byContact = new Map((contacts.data ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const paymentsBySale = new Map<string, Array<{ amount: unknown; status: string }>>();
  for (const p of payments.data ?? []) paymentsBySale.set(p.sale_id, [...(paymentsBySale.get(p.sale_id) ?? []), p]);

  const now = new Date();
  const rows = sales.map((s) => ({
    ...saleListRow(s, paymentsBySale.get(s.id) ?? [], now, timeZone),
    contactName: byContact.get(s.contact_id) ?? "Sin nombre",
    vendedorName: s.vendedor_id ? memberName.get(s.vendedor_id) ?? null : null,
  }));

  const [products, variants] = await Promise.all([
    supabase.from("products").select("id, name").eq("workspace_id", workspace.id).order("name"),
    supabase.from("product_variants").select("id, product_id, name").eq("workspace_id", workspace.id).order("name"),
  ]);

  const props: SalesListData = {
    rows,
    total: count ?? 0,
    page: filters.page,
    pageSize: SALES_PAGE_SIZE,
    filters,
    loadError: !!error,
    pills: { al_dia: pillCounts[0].count ?? 0, con_mora: pillCounts[1].count ?? 0, esta_semana: dueSoonIds.length, canceladas: pillCounts[2].count ?? 0 },
    hasAnySale: (anySale.count ?? 0) > 0,
    scopeAll: hasSalesAllScope(ctx),
    canManage: ctx.can("sales.manage"),
    products: products.data ?? [],
    variants: variants.data ?? [],
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    timeZone,
  };

  return <SalesList data={props} wizard={config} />;
}
