import { PaymentsList, type PaymentsListData } from "@/components/sales/payments-list";
import { requirePermission } from "@/lib/auth/guards";
import { localToday } from "@/lib/sales/dates";
import { monthRange, paymentListRow, parsePaymentsFilters, PAYMENTS_PAGE_SIZE, paymentsQueryFilters, paymentsTotals, weekRange, type QueryFilter } from "@/lib/sales/payments-list";
import { snapshotText } from "@/lib/sales/sale-text";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { hasSalesAllScope } from "@/lib/sales/wizard/load";
import { sanitizeSearch } from "@/lib/url-params";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const COLUMNS = "id, sale_id, type, status, amount, due_date, paid_on, delay_days, payment_method, provider_fee_amount";
const NONE = ["00000000-0000-0000-0000-000000000000"];
const TOTALS_LIMIT = 5000;

type Row = { id: string; sale_id: string; type: string; status: string; amount: number; due_date: string | null; paid_on: string | null; delay_days: number | null; payment_method: string | null; provider_fee_amount: number | null };

/**
 * La pantalla de Pagos (F33). Lee con el cliente del usuario: la RLS (`can_see_sale_id`) decide qué pagos
 * ve cada quien; un Member con alcance `own` ve solo los de sus ventas. Los filtros viven en la URL y se
 * aplican en la consulta. Los totales se calculan en céntimos sobre TODAS las filas del filtro.
 */
export default async function PagosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("sales.view");
  const { supabase, workspace } = ctx;
  const filters = parsePaymentsFilters(await searchParams);
  const w = workspace as unknown as { timezone?: string };
  const methods = workspaceMethods(workspace);
  const today = localToday(new Date(), w.timezone ?? "UTC");

  // El vendedor y la búsqueda se resuelven a las ventas que cumplen (las que esta persona ve).
  let saleIds: string[] | null = null;
  const intersect = (ids: string[]) => { saleIds = saleIds === null ? ids : saleIds.filter((id) => ids.includes(id)); };
  if (filters.vendedorId) {
    const { data } = await supabase.from("sales").select("id").eq("workspace_id", workspace.id).eq("vendedor_id", filters.vendedorId).limit(2000);
    intersect((data ?? []).map((s) => s.id));
  }
  if (filters.q) {
    const q = sanitizeSearch(filters.q, 60);
    const { data: contacts } = await supabase.from("contacts").select("id").eq("workspace_id", workspace.id).is("deleted_at", null).or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`).limit(50);
    const contactIds = (contacts ?? []).map((c) => c.id);
    const { data } = contactIds.length ? await supabase.from("sales").select("id").eq("workspace_id", workspace.id).in("contact_id", contactIds).limit(2000) : { data: [] as Array<{ id: string }> };
    intersect((data ?? []).map((s) => s.id));
  }

  const list: QueryFilter[] = paymentsQueryFilters(filters, today);
  /** Los filtros de columna de la URL aplicados a una consulta de `payments`. */
  function filtered<Q extends { eq: (c: string, v: string) => Q; neq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q; gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q; gt: (c: string, v: number) => Q }>(query: Q): Q {
    let q = query;
    if (saleIds !== null) q = q.in("sale_id", (saleIds as string[]).length ? (saleIds as string[]) : NONE);
    for (const f of list) {
      if (f.op === "eq") q = q.eq(f.column, f.value as string);
      else if (f.op === "neq") q = q.neq(f.column, f.value as string);
      else if (f.op === "in") q = q.in(f.column, f.value as string[]);
      else if (f.op === "gte") q = q.gte(f.column, f.value as string);
      else if (f.op === "lte") q = q.lte(f.column, f.value as string);
      else q = q.gt(f.column, Number(f.value));
    }
    return q;
  }

  const week = weekRange(today);
  const month = monthRange(today);
  const from = (filters.page - 1) * PAYMENTS_PAGE_SIZE;
  const head = () => supabase.from("payments").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id);
  const [page, totalsRes, thisWeek, overdue, paidMonth, uncollectible, members] = await Promise.all([
    filtered(supabase.from("payments").select(COLUMNS, { count: "exact" }).eq("workspace_id", workspace.id) as never as ReturnType<typeof head>)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAYMENTS_PAGE_SIZE - 1),
    filtered(supabase.from("payments").select("status, amount, provider_fee_amount").eq("workspace_id", workspace.id) as never as ReturnType<typeof head>).limit(TOTALS_LIMIT),
    head().eq("status", "scheduled").gte("due_date", week.from).lte("due_date", week.to),
    head().eq("status", "overdue"),
    head().eq("status", "paid").neq("type", "refund").gte("paid_on", month.from).lte("paid_on", month.to),
    head().eq("status", "uncollectible"),
    getWorkspaceMembers(workspace.id),
  ]);

  const payments = (page.data ?? []) as unknown as Row[];
  const saleIdsOnPage = [...new Set(payments.map((p) => p.sale_id))];
  const { data: sales } = saleIdsOnPage.length ? await supabase.from("sales").select("id, contact_id, sale_date, product_snapshot").in("id", saleIdsOnPage) : { data: [] as Array<{ id: string; contact_id: string; sale_date: string; product_snapshot: unknown }> };
  const { data: contacts } = (sales ?? []).length ? await supabase.from("contacts").select("id, display_name, email").in("id", [...new Set((sales ?? []).map((s) => s.contact_id))]) : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const saleById = new Map((sales ?? []).map((s) => [s.id, s]));
  const contactName = new Map((contacts ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));

  const canManage = ctx.can("payments.manage");
  const totalsRows = (totalsRes.data ?? []) as unknown as Array<{ status: string; amount: number; provider_fee_amount: number | null }>;
  const data: PaymentsListData = {
    rows: payments.map((p) => {
      const sale = saleById.get(p.sale_id);
      return {
        ...paymentListRow(p, canManage, methods.defs),
        contactName: sale ? contactName.get(sale.contact_id) ?? "Sin nombre" : "—",
        contactId: sale?.contact_id ?? null,
        product: sale ? snapshotText(sale.product_snapshot) : "—",
        saleDate: sale?.sale_date ?? "",
      };
    }),
    total: page.count ?? 0,
    page: filters.page,
    pageSize: PAYMENTS_PAGE_SIZE,
    filters,
    loadError: !!page.error,
    pills: { esta_semana: thisWeek.count ?? 0, morosos: overdue.count ?? 0, cobrados_mes: paidMonth.count ?? 0, incobrables: uncollectible.count ?? 0 },
    totals: paymentsTotals(totalsRows),
    totalsTruncated: totalsRows.length >= TOTALS_LIMIT,
    scopeAll: hasSalesAllScope(ctx),
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    enabledMethods: methods.enabledKeys,
    methods: methods.defs,
    today,
  };
  return <PaymentsList data={data} />;
}
