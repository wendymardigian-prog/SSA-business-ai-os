import { SalesList, type SalesListData } from "@/components/sales/sales-list";
import { requirePermission } from "@/lib/auth/guards";
import { localToday, addDays } from "@/lib/shared/dates";
import { PILL_STATUSES, SALES_PAGE_SIZE, parseSalesFilters, saleListRow, salesQueryFilters, touchEmbed, type QueryFilter } from "@/lib/sales/list";
import { buildOriginViews, loadOriginParts } from "@/lib/sales/attribution-load";
import { loadWizardConfig, hasSalesAllScope } from "@/lib/sales/wizard/load";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { sanitizeSearch } from "@/lib/url-params";
import { SALES_TABLE_KEY } from "@/lib/sales/columns";
import { computeSalesTotals } from "@/lib/sales/sales-totals";
import { loadTableViews } from "@/lib/ui/data-table/views-load";
import type { PageResult } from "@/lib/shared/paginate";
import { ensureSalesTemplateFlows } from "@/lib/sales/automation/templates-run";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { ModuleColumn } from "@/lib/sales/module-columns"; // @plantilla-quitar(servicios)
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import { servicesSalesColumn } from "@/lib/services/screens/sales-column"; // @plantilla-quitar(servicios)

export const dynamic = "force-dynamic";

const COLUMNS = "id, contact_id, sale_date, status, final_amount, product_snapshot, attribution, attribution_touch_id, attribution_type, vendedor_id, setter_id";

/** Lo que trae la consulta (con el toque embebido, el tipo de la libreria no lo conoce: se declara aca). */
interface SaleDbRow {
  id: string;
  contact_id: string;
  sale_date: string;
  status: string;
  final_amount: unknown;
  product_snapshot: unknown;
  attribution: unknown;
  attribution_touch_id: string | null;
  attribution_type: string;
  vendedor_id: string | null;
  setter_id: string | null;
}

/**
 * La lista de ventas (F25). Lee con el cliente del usuario: la RLS (`can_see_sale`) decide qué ve
 * cada quien; un Member con alcance `own` ve solo las suyas aunque la URL pida otro vendedor.
 * Los filtros viven en la URL y se aplican EN LA CONSULTA, nunca en memoria.
 */
export default async function VentasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("sales.view");
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  // Las vistas guardadas de esta persona: si la URL llegó pelada, los filtros de su vista predeterminada se aplican acá.
  const viewsData = await loadTableViews(ctx, SALES_TABLE_KEY, sp);
  const inherited = viewsData.resolved.inheritedFilters;
  const filters = parseSalesFilters(inherited ? { ...Object.fromEntries(new URLSearchParams(inherited)), pagina: sp.pagina } : sp);
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
  /** Los filtros aplicados a una consulta de `sales`: la de la página y la de los totales cuentan EXACTAMENTE lo mismo. */
  function filteredSales(select: string, options?: { count: "exact" }) {
    let query = supabase.from("sales").select(select, options).eq("workspace_id", workspace.id);
    for (const f of salesQueryFilters(filters) as QueryFilter[]) {
      if (f.op === "eq") query = query.eq(f.column, f.value as string);
      else if (f.op === "in") query = query.in(f.column, f.value as string[]);
      else if (f.op === "gte") query = query.gte(f.column, f.value as string);
      else if (f.op === "lte") query = query.lte(f.column, f.value as string);
      else query = query.ilike(f.column, f.value as string);
    }
    if (filters.pill === "esta_semana") query = query.in("id", dueSoonIds.length ? dueSoonIds : ["00000000-0000-0000-0000-000000000000"]);
    if (contactIds) query = query.in("contact_id", contactIds.length ? contactIds : ["00000000-0000-0000-0000-000000000000"]);
    return query;
  }
  // Con un filtro por canal o por pieza se suma el toque como `inner` (las ventas cuyo toque no cumple quedan afuera).
  const embed = touchEmbed(filters);
  const [pageRes, totals] = await Promise.all([
    filteredSales(`${COLUMNS}${embed}`, { count: "exact" }).order("sale_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + SALES_PAGE_SIZE - 1),
    // Los totales del pie son de TODAS las ventas del filtro (no solo de esta página), brutos.
    computeSalesTotals(
      (a, b) => filteredSales(`id, final_amount${embed}`).order("id").range(a, b) as unknown as PromiseLike<PageResult<{ id: string; final_amount: unknown }>>,
      (ids, a, b) => supabase.from("payments").select("sale_id, amount, status").in("sale_id", ids).order("id").range(a, b) as unknown as PromiseLike<PageResult<{ sale_id: string; amount: unknown; status: string }>>,
    ),
  ]);
  const { data, count, error } = pageRes;

  const sales = (data ?? []) as unknown as SaleDbRow[];
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

  // De donde vino cada venta (F49): el toque, la pieza o el anuncio, en una consulta por tabla (no una por venta).
  const canViewAds = ctx.can("dashboards.ads.view");
  const originParts = await loadOriginParts(supabase, {
    workspaceId: workspace.id,
    touchIds: sales.map((s) => s.attribution_touch_id).filter((id): id is string => !!id),
    memberNames: memberName,
    canViewAds,
  });
  const origins = buildOriginViews(sales, originParts, canViewAds);

  const now = new Date();
  const rows = sales.map((s) => ({
    ...saleListRow(s, paymentsBySale.get(s.id) ?? [], now, timeZone),
    origin: { channel: origins[s.id].channel, channelLabel: origins[s.id].channelLabel, summary: origins[s.id].summary },
    contactName: byContact.get(s.contact_id) ?? "Sin nombre",
    vendedorName: s.vendedor_id ? memberName.get(s.vendedor_id) ?? null : null,
  }));

  const pieceTitle = filters.pieceId ? (await supabase.from("content_posts").select("title").eq("id", filters.pieceId).eq("workspace_id", workspace.id).maybeSingle()).data?.title ?? null : null;

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
    pieceTitle,
    totals,
    views: {
      items: viewsData.views,
      defaultViewId: viewsData.defaultViewId,
      activeId: viewsData.resolved.active?.id ?? null,
      viewParam: viewsData.resolved.viewParam,
      activeBase: viewsData.resolved.active?.config.columns ?? null,
      userId: viewsData.userId,
      isAdmin: viewsData.isAdmin,
    },
  };

  // @plantilla-desde(servicios)
  // F95: con el modulo de Servicios prendido, la columna Servicio por el punto de extension de Ventas.
  const moduleColumns: ModuleColumn[] = [];
  if (isModuleEnabled(workspace as { services_enabled?: boolean | null })) {
    const col = await servicesSalesColumn(supabase, workspace.id, rows.map((r) => r.id), ctx.can);
    if (col) moduleColumns.push(col);
  }
  return <SalesList data={props} wizard={config} moduleColumns={moduleColumns} />;
  // @plantilla-hasta(servicios)
  // @plantilla-sin(servicios): return <SalesList data={props} wizard={config} />;
}
