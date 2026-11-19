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
import { DB_SORT_COLUMNS, isDbSort, pageOfSortedIds } from "@/lib/sales/sort";
import { loadTableViews } from "@/lib/ui/data-table/views-load";
import type { PageResult } from "@/lib/shared/paginate";
import { ensureSalesTemplateFlows } from "@/lib/sales/automation/templates-run";
import { createServiceClient } from "@/lib/supabase/server";
import { after } from "next/server";
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
  const today = localToday(new Date(), workspace.timezone);
  const weekEnd = addDays(today, 7);

  // Los cuatro flujos de cobranza (apagados) se crean la primera vez que un Owner o Admin abre Ventas; es idempotente
  // y respeta la opcion de Ajustes. No hay backfill durante el deploy. Va en `after()`: la pantalla no los muestra, así
  // que no tiene por qué esperar sus consultas.
  if (ctx.role === "owner" || ctx.role === "admin") after(async () => {
      await ensureSalesTemplateFlows(await createServiceClient(), workspace.id);
    });

  // Todo lo que NO depende de los filtros sale en la misma tanda: la app y la base están lejos, y cada consulta en fila
  // suma una ida y vuelta entera.
  const independent = Promise.all([
    resolveViewerTimezone(workspace.timezone),
    // «Por cobrar esta semana»: ventas con algún pago programado que vence en los próximos 7 días.
    supabase.from("payments").select("sale_id").eq("workspace_id", workspace.id).eq("status", "scheduled").gte("due_date", today).lte("due_date", weekEnd).limit(1000),
    getWorkspaceMembers(workspace.id),
    loadWizardConfig(ctx),
    supabase.from("products").select("id, name").eq("workspace_id", workspace.id).order("name"),
    supabase.from("product_variants").select("id, product_id, name").eq("workspace_id", workspace.id).order("name"),
    supabase.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    Promise.all((["al_dia", "con_mora", "canceladas"] as const).map((p) => supabase.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", [...PILL_STATUSES[p]] as never[]))),
  ]);
  // Que una falla de la tanda no quede como promesa rechazada sin escuchar mientras se esperan las vistas (se vuelve a lanzar abajo).
  independent.catch(() => undefined);

  // Las vistas guardadas de esta persona: si la URL llegó pelada, los filtros de su vista predeterminada se aplican acá.
  const viewsData = await loadTableViews(ctx, SALES_TABLE_KEY, sp);
  const inherited = viewsData.resolved.inheritedFilters;
  const filters = parseSalesFilters(inherited ? { ...Object.fromEntries(new URLSearchParams(inherited)), pagina: sp.pagina } : sp);

  // La búsqueda mira los contactos que coinciden (los que esta persona ve). El título de la pieza, si se filtra por una.
  const q = filters.q ? sanitizeSearch(filters.q, 60) : null;
  const [[timeZone, dueSoon, members, config, products, variants, anySale, pillCounts], searchRes, pieceTitle] = await Promise.all([
    independent,
    q !== null
      ? supabase
          .from("contacts")
          .select("id")
          .eq("workspace_id", workspace.id)
          .is("deleted_at", null)
          .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(50)
      : Promise.resolve(null),
    filters.pieceId
      ? supabase.from("content_posts").select("title").eq("id", filters.pieceId).eq("workspace_id", workspace.id).maybeSingle().then((r) => r.data?.title ?? null)
      : Promise.resolve(null),
  ]);
  const dueSoonIds = [...new Set((dueSoon.data ?? []).map((p) => p.sale_id))];
  const contactIds: string[] | null = searchRes ? (searchRes.data ?? []).map((c) => c.id) : null;

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
  // Fecha y Monto los ordena la base; Cobrado, Pendiente y Próximo pago salen de los pagos y se ordenan con la misma
  // pasada completa de los totales del pie (así ordenan TODAS las ventas del filtro, no solo la página).
  const dbSort = isDbSort(filters.sort);
  const totalsPromise = computeSalesTotals(
    (a, b) => filteredSales(`id, final_amount, sale_date${embed}`).order("id").range(a, b) as unknown as PromiseLike<PageResult<{ id: string; final_amount: unknown; sale_date: string }>>,
    (ids, a, b) =>
      supabase.from("payments").select("id, sale_id, amount, status, due_date").in("sale_id", ids).order("id").range(a, b) as unknown as PromiseLike<
        PageResult<{ id: string; sale_id: string; amount: unknown; status: string; due_date: string | null }>
      >,
    { withSummaries: !dbSort },
  );
  /** La página por fecha o por monto, ordenada en la consulta. */
  const dbPage = (column: string, ascending: boolean) => {
    let query = filteredSales(`${COLUMNS}${embed}`, { count: "exact" }).order(column, { ascending });
    if (column !== "sale_date") query = query.order("sale_date", { ascending: false });
    return query.order("created_at", { ascending: false }).range(from, from + SALES_PAGE_SIZE - 1);
  };
  let sortFallback = false;
  let pageRes: { data: unknown[] | null; count: number | null; error: unknown };
  let totals: Awaited<typeof totalsPromise>;
  if (dbSort) {
    const [res, t] = await Promise.all([dbPage(DB_SORT_COLUMNS[filters.sort.key]!, filters.sort.dir === "asc"), totalsPromise]);
    pageRes = res;
    totals = t;
  } else {
    totals = await totalsPromise;
    if (!totals?.summaries) {
      // Sin la pasada completa no se puede ordenar por lo que sale de los pagos: se muestra por fecha y se avisa.
      sortFallback = true;
      pageRes = await dbPage("sale_date", false);
    } else {
      const ids = pageOfSortedIds(totals.summaries, filters.sort, from, SALES_PAGE_SIZE);
      const res = ids.length ? await supabase.from("sales").select(COLUMNS).in("id", ids) : { data: [], error: null };
      const position = new Map(ids.map((id, i) => [id, i]));
      const ordered = ((res.data ?? []) as unknown as SaleDbRow[]).sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
      pageRes = { data: ordered, count: totals.count, error: res.error };
    }
  }
  const { data, count, error } = pageRes;

  const sales = (data ?? []) as unknown as SaleDbRow[];
  const saleIds = sales.map((s) => s.id);
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  // De donde vino cada venta (F49): el toque, la pieza o el anuncio, en una consulta por tabla (no una por venta).
  const canViewAds = ctx.can("dashboards.ads.view");
  // Lo que depende de las filas de esta página, todo en la misma tanda.
  const [payments, contacts, originParts, moduleColumns] = await Promise.all([
    saleIds.length
      ? supabase.from("payments").select("id, sale_id, amount, status, due_date").in("sale_id", saleIds)
      : Promise.resolve({ data: [] as Array<{ id: string; sale_id: string; amount: number; status: string; due_date: string | null }> }),
    sales.length ? supabase.from("contacts").select("id, display_name, email").in("id", [...new Set(sales.map((s) => s.contact_id))]) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }> }),
    loadOriginParts(supabase, {
      workspaceId: workspace.id,
      touchIds: sales.map((s) => s.attribution_touch_id).filter((id): id is string => !!id),
      memberNames: memberName,
      canViewAds,
    }),
    // @plantilla-desde(servicios)
    // F95: con el modulo de Servicios prendido, la columna Servicio por el punto de extension de Ventas (por id de venta).
    isModuleEnabled(workspace as { services_enabled?: boolean | null }) ? servicesSalesColumn(supabase, workspace.id, saleIds, ctx.can).then((col): ModuleColumn[] => (col ? [col] : [])) : Promise.resolve([] as ModuleColumn[]),
    // @plantilla-hasta(servicios)
    // @plantilla-sin(servicios): Promise.resolve([]),
  ]);

  const byContact = new Map((contacts.data ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));
  const paymentsBySale = new Map<string, Array<{ id: string; amount: unknown; status: string; due_date: string | null }>>();
  for (const p of payments.data ?? []) paymentsBySale.set(p.sale_id, [...(paymentsBySale.get(p.sale_id) ?? []), p]);

  const origins = buildOriginViews(sales, originParts, canViewAds);

  const now = new Date();
  const rows = sales.map((s) => ({
    ...saleListRow(s, paymentsBySale.get(s.id) ?? [], now, timeZone),
    origin: { channel: origins[s.id].channel, channelLabel: origins[s.id].channelLabel, summary: origins[s.id].summary },
    contactName: byContact.get(s.contact_id) ?? "Sin nombre",
    vendedorName: s.vendedor_id ? memberName.get(s.vendedor_id) ?? null : null,
  }));

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
    canDelete: ctx.can("sales.delete"),
    products: products.data ?? [],
    variants: variants.data ?? [],
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    timeZone,
    pieceTitle,
    totals: totals ? { count: totals.count, amount: totals.amount, paid: totals.paid, pending: totals.pending, truncated: totals.truncated } : null,
    sortFallback,
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
  return <SalesList data={props} wizard={config} moduleColumns={moduleColumns} />;
  // @plantilla-hasta(servicios)
  // @plantilla-sin(servicios): return <SalesList data={props} wizard={config} />;
}
