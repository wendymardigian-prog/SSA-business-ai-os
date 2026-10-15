/**
 * Lo que necesitan las pantallas de Comisiones (SOLO servidor): la lista con sus totales, el detalle de una comisión
 * y la pantalla de reglas.
 *
 * Quién lee qué:
 *   - `commissions` y `commission_rules` se leen con la SESIÓN de quien mira: la RLS decide qué ve cada quien
 *     (`can_see_commission`: Owner/Admin, un rol con alcance `all`, o la persona a la que se le debe).
 *   - Los gastos de esas comisiones, con el cliente de SERVICIO y DESPUÉS de `commissions.view`, y de cada gasto sale
 *     SOLO `{ expense_id, status, scheduled_date, paid_date }`: quien ve su comisión no ve el resto del gasto.
 *   - Los nombres (contacto, producto, persona) y la venta, con el servicio y filtrando por el workspace de la sesión,
 *     solo para las filas que la RLS ya dejó pasar.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { financeContextOf } from "@/lib/finance/context";
import { fetchAllPages } from "@/lib/finance/paginate";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { toCents } from "@/lib/sales/money";
import { addDays } from "@/lib/sales/dates";
import type { CommissionRole, CommissionRule } from "./types";
import { COMMISSIONS_PAGE_SIZE, paidRange, type CommissionFilters, type CommissionGroupBy, type CommissionPill, type StatusTotals } from "./filters";
import {
  applyDerivedFilters, classifyRows, groupRows, paginate, pillSummary, sortRows, statusTotals,
  type ClassifiedRow, type ExpenseRef, type GroupSummary, type LightCommission, type SaleLink,
} from "./list-model";
import { selectableReasonCode, type NotSelectableCode } from "./selection";
import { commissionStatus, type CommissionStatusResult } from "./status";
import { compareRuleSnapshot, type RuleComparison } from "./detail-model";
import { RULE_COLUMNS, commissionRuleFromRow } from "./rule-row";
import { buildRuleViews, utmSuggestions, type RuleView, type UtmSuggestions } from "./rules-view";
import { readCommissionSettings } from "./server-refs";
import type { DescribeLookups } from "./describe";

/** Tope de comisiones que se leen para los totales, las pastillas y la paginación (si hay más, se avisa). */
export const COMMISSIONS_LOAD_LIMIT = 5000;

type Service = Awaited<ReturnType<typeof createServiceClient>>;
type Ctx = Pick<PermissionContext, "supabase" | "workspace" | "user" | "can" | "scope">;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIGHT_COLUMNS = "id, kind, role, user_id, payment_id, sale_id, rule_id, amount, base_amount, paid_on, available_on, expense_id, voided_at, created_at";
const EXTRA_COLUMNS = "id, rule_snapshot, attribution_snapshot, notes, void_reason";
const DETAIL_COLUMNS = `${LIGHT_COLUMNS}, rule_snapshot, attribution_snapshot, attribution_touch_id, currency, notes, void_reason, voided_by, created_by, updated_at`;

const chunk = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const uniq = <T>(list: ReadonlyArray<T | null | undefined>): T[] => [...new Set(list.filter((v): v is T => v !== null && v !== undefined))];

type Builder = {
  eq: (column: string, value: string) => Builder;
  in: (column: string, values: readonly string[]) => Builder;
  gte: (column: string, value: string) => Builder;
  lte: (column: string, value: string) => Builder;
};

/** Los filtros que se pueden aplicar en la consulta (los que no dependen del estado derivado ni de la venta). */
function applyPushdown<T>(query: T, filters: CommissionFilters, saleIds: readonly string[] | null): T {
  let q = query as unknown as Builder;
  if (filters.users.length) q = q.in("user_id", filters.users);
  if (filters.roles.length) q = q.in("role", filters.roles);
  const { from, to } = paidRange(filters);
  if (from) q = q.gte("paid_on", from);
  if (to) q = q.lte("paid_on", to);
  if (filters.saleId) q = q.eq("sale_id", filters.saleId);
  if (filters.expenseId) q = q.eq("expense_id", filters.expenseId);
  if (filters.ruleId) q = q.eq("rule_id", filters.ruleId);
  if (saleIds) q = q.in("sale_id", saleIds);
  return q as unknown as T;
}

// ── Piezas de lectura ──────────────────────────────────────────────────

/** De cada gasto, SOLO lo que el estado de una comisión necesita. */
async function loadExpenseRefs(service: Service, workspaceId: string, expenseIds: readonly string[]): Promise<Map<string, ExpenseRef>> {
  const out = new Map<string, ExpenseRef>();
  for (const part of chunk(uniq(expenseIds), 100)) {
    const { data, error } = await service.from("expenses").select("id, status, scheduled_date, paid_date").eq("workspace_id", workspaceId).in("id", part);
    if (error) {
      console.error("[comisiones] no pude leer los gastos:", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; status: string; scheduled_date: string | null; paid_date: string | null }>) {
      out.set(row.id, { expense_id: row.id, status: row.status, scheduled_date: row.scheduled_date, paid_date: row.paid_date });
    }
  }
  return out;
}

interface SaleBits extends SaleLink {
  product_variant_id: string | null;
}

/** Contacto y producto de cada venta (para filtrar, agrupar y pintar). El producto sale de la variante. */
async function loadSaleLinks(service: Service, workspaceId: string, saleIds: readonly string[]): Promise<Map<string, SaleBits>> {
  const sales = new Map<string, { contact_id: string | null; product_variant_id: string | null }>();
  for (const part of chunk(uniq(saleIds), 100)) {
    const { data, error } = await service.from("sales").select("id, contact_id, product_variant_id").eq("workspace_id", workspaceId).in("id", part);
    if (error) {
      console.error("[comisiones] no pude leer las ventas:", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; contact_id: string | null; product_variant_id: string | null }>) sales.set(row.id, row);
  }
  const variantIds = uniq([...sales.values()].map((s) => s.product_variant_id));
  const productOf = new Map<string, string>();
  for (const part of chunk(variantIds, 100)) {
    const { data } = await service.from("product_variants").select("id, product_id").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; product_id: string }>) productOf.set(row.id, row.product_id);
  }
  const out = new Map<string, SaleBits>();
  for (const [id, sale] of sales) {
    out.set(id, { contact_id: sale.contact_id, product_variant_id: sale.product_variant_id, product_id: sale.product_variant_id ? productOf.get(sale.product_variant_id) ?? null : null });
  }
  return out;
}

interface Names {
  contacts: Map<string, string>;
  products: Map<string, string>;
  variants: Map<string, string>;
}

async function loadNames(service: Service, workspaceId: string, links: ReadonlyMap<string, SaleBits>): Promise<Names> {
  const contactIds = uniq([...links.values()].map((l) => l.contact_id));
  const variantIds = uniq([...links.values()].map((l) => l.product_variant_id));
  const productIds = uniq([...links.values()].map((l) => l.product_id));
  const names: Names = { contacts: new Map(), products: new Map(), variants: new Map() };
  for (const part of chunk(contactIds, 100)) {
    const { data } = await service.from("contacts").select("id, display_name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; display_name: string | null }>) names.contacts.set(row.id, row.display_name?.trim() || "Sin nombre");
  }
  for (const part of chunk(variantIds, 100)) {
    const { data } = await service.from("product_variants").select("id, name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.variants.set(row.id, row.name);
  }
  for (const part of chunk(productIds, 100)) {
    const { data } = await service.from("products").select("id, name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.products.set(row.id, row.name);
  }
  return names;
}

// ── La lista ───────────────────────────────────────────────────────────

export interface CommissionListRow {
  id: string;
  kind: "earned" | "adjustment";
  role: string | null;
  roleName: string | null;
  userId: string | null;
  userName: string | null;
  saleId: string | null;
  paymentId: string | null;
  contactId: string | null;
  contactName: string | null;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  /** Céntimos; negativo en un ajuste que resta. */
  amountCents: number;
  baseCents: number | null;
  paidOn: string | null;
  availableOn: string;
  ruleId: string | null;
  /** El nombre de la regla CON LA QUE se calculó (de la foto guardada). */
  ruleName: string | null;
  attribution: { channel: string | null; source: string | null; contentTitle: string | null; adName: string | null } | null;
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  /** Solo `{ expense_id, status, scheduled_date, paid_date }` del gasto. */
  expense: ExpenseRef | null;
  status: CommissionStatusResult;
  /** Por qué NO se puede seleccionar para una liquidación, o null si se puede. */
  notSelectable: NotSelectableCode | null;
}

export interface CommissionListData {
  rows: CommissionListRow[];
  /** Filas que cumplen TODO el filtro (no solo esta página). */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  filters: CommissionFilters;
  /** `own`: la persona ve solo lo suyo (la RLS ya filtra las filas). */
  scope: "own" | "all";
  today: string;
  tz: string;
  /** Cuenta y suma por estado de TODAS las filas del filtro, en céntimos. */
  totals: StatusTotals;
  /** Las pastillas, sobre el filtro SIN la pastilla ni el estado. */
  pills: Record<CommissionPill, { count: number; cents: number }>;
  groupBy: CommissionGroupBy | null;
  groups: GroupSummary[] | null;
  /** Había más filas que el tope: los totales, las pastillas y la paginación miran las más nuevas. */
  truncated: boolean;
  loadError: boolean;
  /** No tiene `commissions.view`. */
  denied: boolean;
  roles: CommissionRole[];
  members: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  canManage: boolean;
  /** Puede generar gastos de liquidación (comisiones Y gastos). */
  canPayout: boolean;
}

function emptyList(ctx: Ctx, filters: CommissionFilters, today: string, tz: string, scope: "own" | "all", patch: Partial<CommissionListData>): CommissionListData {
  return {
    rows: [], total: 0, page: 1, pageSize: COMMISSIONS_PAGE_SIZE, pages: 1, filters, scope, today, tz,
    totals: statusTotals([]), pills: pillSummary([], today), groupBy: filters.groupBy, groups: null, truncated: false, loadError: false, denied: false,
    roles: [], members: [], products: [], canManage: ctx.can("commissions.manage"), canPayout: ctx.can("commissions.manage") && ctx.can("expenses.manage"), ...patch,
  };
}

export async function loadCommissionList(ctx: Ctx, filters: CommissionFilters): Promise<CommissionListData> {
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  const scope: "own" | "all" = ctx.scope("commissions") === "all" ? "all" : "own";
  if (!ctx.can("commissions.view")) return emptyList(ctx, filters, f.todayLocal, f.tz, scope, { denied: true });

  const service = await createServiceClient();

  // Un contacto es de la venta: se traduce a sus ventas (pocas) y se filtra en la consulta.
  let saleIds: string[] | null = null;
  if (filters.contactId) {
    const { data } = await service.from("sales").select("id").eq("workspace_id", ws).eq("contact_id", filters.contactId).limit(1000);
    saleIds = ((data ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (saleIds.length === 0) {
      const settings = await readCommissionSettings(service, ws);
      return emptyList(ctx, filters, f.todayLocal, f.tz, scope, { roles: settings?.roles ?? [] });
    }
  }

  const [fetched, settings, members] = await Promise.all([
    fetchAllPages<LightCommission>(
      (from, to) =>
        applyPushdown(ctx.supabase.from("commissions").select(LIGHT_COLUMNS).eq("workspace_id", ws), filters, saleIds)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: LightCommission[] | null; error: { message: string } | null }>,
      { maxRows: COMMISSIONS_LOAD_LIMIT + 1 },
    ),
    readCommissionSettings(service, ws),
    getWorkspaceMembers(ws),
  ]);
  const roles = settings?.roles ?? [];
  const memberList = members.map((m) => ({ id: m.userId, name: m.name }));
  if (fetched.error) {
    console.error("[comisiones] no pude leer las comisiones:", fetched.error);
    return emptyList(ctx, filters, f.todayLocal, f.tz, scope, { loadError: true, roles, members: scope === "all" ? memberList : [] });
  }
  const truncated = fetched.truncated || fetched.rows.length > COMMISSIONS_LOAD_LIMIT;
  const light = fetched.rows.slice(0, COMMISSIONS_LOAD_LIMIT);

  const needsSaleLinks = filters.products.length > 0 || filters.groupBy === "producto";
  const [expenses, saleLinks] = await Promise.all([
    loadExpenseRefs(service, ws, light.map((r) => r.expense_id).filter((id): id is string => !!id)),
    needsSaleLinks ? loadSaleLinks(service, ws, light.map((r) => r.sale_id).filter((id): id is string => !!id)) : Promise.resolve(new Map<string, SaleBits>()),
  ]);

  const classified = classifyRows(light, expenses, saleLinks, f.todayLocal);
  // El contacto ya se filtró en la consulta (por sus ventas): no se vuelve a filtrar acá.
  const derived = { statuses: filters.statuses, pill: filters.pill, products: filters.products, contactId: null };
  const matched = sortRows(applyDerivedFilters(classified, derived, f.todayLocal));
  const forPills = applyDerivedFilters(classified, derived, f.todayLocal, { skipStatus: true });
  const pageData = paginate(matched, filters.page, COMMISSIONS_PAGE_SIZE);

  const rows = await hydratePage(ctx, service, pageData.rows, { roles, members, scope, today: f.todayLocal });

  const productList =
    scope === "all"
      ? (((await service.from("products").select("id, name").eq("workspace_id", ws).order("name", { ascending: true }).limit(500)).data ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }))
      : [];

  return {
    rows,
    total: matched.length,
    page: pageData.page,
    pageSize: COMMISSIONS_PAGE_SIZE,
    pages: pageData.pages,
    filters,
    scope,
    today: f.todayLocal,
    tz: f.tz,
    totals: statusTotals(matched),
    pills: pillSummary(forPills, f.todayLocal),
    groupBy: filters.groupBy,
    groups: filters.groupBy ? groupRows(matched, filters.groupBy) : null,
    truncated,
    loadError: false,
    denied: false,
    roles,
    members: scope === "all" ? memberList : [],
    products: productList,
    canManage: ctx.can("commissions.manage"),
    canPayout: ctx.can("commissions.manage") && ctx.can("expenses.manage"),
  };
}

type SnapshotRecord = Record<string, unknown>;
const asRecord = (value: unknown): SnapshotRecord | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as SnapshotRecord) : null);
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function attributionOf(snapshot: unknown): CommissionListRow["attribution"] {
  const s = asRecord(snapshot);
  if (!s) return null;
  return { channel: textOrNull(s.channel), source: textOrNull(s.source), contentTitle: textOrNull(s.content_title), adName: textOrNull(s.ad_name) };
}

/** Lo que falta para pintar las 50 filas de la página: los textos largos, la venta, los nombres. */
async function hydratePage(
  ctx: Ctx,
  service: Service,
  page: readonly ClassifiedRow[],
  env: { roles: readonly CommissionRole[]; members: ReadonlyArray<{ userId: string; name: string }>; scope: "own" | "all"; today: string },
): Promise<CommissionListRow[]> {
  if (page.length === 0) return [];
  const ws = ctx.workspace.id;
  const { data: extraRows } = await ctx.supabase.from("commissions").select(EXTRA_COLUMNS).eq("workspace_id", ws).in("id", page.map((r) => r.commission.id));
  const extras = new Map(((extraRows ?? []) as unknown as Array<{ id: string; rule_snapshot: unknown; attribution_snapshot: unknown; notes: string | null; void_reason: string | null }>).map((r) => [r.id, r]));
  const links = await loadSaleLinks(service, ws, page.map((r) => r.commission.sale_id).filter((id): id is string => !!id));
  const names = await loadNames(service, ws, links);
  const roleName = new Map(env.roles.map((r) => [r.key, r.name]));
  const memberName = new Map(env.members.map((m) => [m.userId, m.name]));

  return page.map((row) => {
    const c = row.commission;
    const link = c.sale_id ? links.get(c.sale_id) ?? null : null;
    const extra = extras.get(c.id);
    // Una persona de alcance `own` solo ve lo suyo; igual, nunca se le devuelve el nombre de otra.
    const showPerson = env.scope === "all" || c.user_id === ctx.user.id;
    return {
      id: c.id,
      kind: c.kind,
      role: c.role,
      roleName: c.role ? roleName.get(c.role) ?? c.role : null,
      userId: showPerson ? c.user_id : null,
      userName: showPerson && c.user_id ? memberName.get(c.user_id) ?? null : null,
      saleId: c.sale_id,
      paymentId: c.payment_id,
      contactId: link?.contact_id ?? null,
      contactName: link?.contact_id ? names.contacts.get(link.contact_id) ?? null : null,
      productId: link?.product_id ?? null,
      productName: link?.product_id ? names.products.get(link.product_id) ?? null : null,
      variantName: link?.product_variant_id ? names.variants.get(link.product_variant_id) ?? null : null,
      amountCents: row.amountCents,
      baseCents: c.base_amount === null || c.base_amount === undefined ? null : toCents(c.base_amount),
      paidOn: c.paid_on,
      availableOn: c.available_on,
      ruleId: c.rule_id,
      ruleName: textOrNull(asRecord(extra?.rule_snapshot)?.name),
      attribution: attributionOf(extra?.attribution_snapshot),
      notes: extra?.notes ?? null,
      voidReason: extra?.void_reason ?? null,
      voidedAt: c.voided_at,
      createdAt: c.created_at,
      expense: row.expense,
      status: row.status,
      notSelectable: selectableReasonCode(c, row.expense ? { status: row.expense.status, scheduled_date: row.expense.scheduled_date, paid_date: row.expense.paid_date } : null, env.today),
    };
  });
}

// ── El detalle ─────────────────────────────────────────────────────────

export interface CommissionDetail {
  id: string;
  kind: "earned" | "adjustment";
  role: string | null;
  roleName: string | null;
  userId: string | null;
  userName: string | null;
  amountCents: number;
  baseCents: number | null;
  paidOn: string | null;
  availableOn: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdAt: string;
  createdByName: string | null;
  expense: ExpenseRef | null;
  status: CommissionStatusResult;
  notSelectable: NotSelectableCode | null;
  sale: { id: string; contactId: string | null; contactName: string | null; productName: string | null; variantName: string | null; saleDate: string | null; financingType: string | null } | null;
  /** Lo cobrado: el monto y la comisión del procesador solo los ve quien tiene alcance `all`. */
  payment: { id: string; type: string; status: string; paidOn: string | null; method: string | null; amountCents: number | null; feeCents: number | null } | null;
  attribution: { snapshot: SnapshotRecord | null; touch: { id: string; channel: string | null; source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null; origin: string | null; occurredAt: string } | null };
  /** La regla con la que se calculó (la foto) frente a la regla de hoy. La actual solo la ve quien puede ver reglas. */
  rule: { used: SnapshotRecord | null; current: CommissionRule | null; comparison: RuleComparison };
  scope: "own" | "all";
  canManage: boolean;
  canPayout: boolean;
  today: string;
  tz: string;
}

export async function loadCommissionDetail(ctx: Ctx, id: string): Promise<CommissionDetail | null> {
  if (!ctx.can("commissions.view") || !UUID_RE.test(id)) return null;
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  const scope: "own" | "all" = ctx.scope("commissions") === "all" ? "all" : "own";

  // La RLS decide: si la persona no la puede ver, no vuelve nada.
  const { data } = await ctx.supabase.from("commissions").select(DETAIL_COLUMNS).eq("id", id).eq("workspace_id", ws).maybeSingle();
  const c = data as unknown as (LightCommission & {
    rule_snapshot: unknown; attribution_snapshot: unknown; attribution_touch_id: string | null; notes: string | null; void_reason: string | null; voided_by: string | null; created_by: string | null;
  }) | null;
  if (!c) return null;

  const service = await createServiceClient();
  const [expenses, settings, members] = await Promise.all([
    c.expense_id ? loadExpenseRefs(service, ws, [c.expense_id]) : Promise.resolve(new Map<string, ExpenseRef>()),
    readCommissionSettings(service, ws),
    getWorkspaceMembers(ws),
  ]);
  const expense = c.expense_id ? expenses.get(c.expense_id) ?? null : null;
  const status = commissionStatus(c, expense ? { status: expense.status, scheduled_date: expense.scheduled_date, paid_date: expense.paid_date } : null, f.todayLocal);
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const showPerson = (userId: string | null) => (userId && (scope === "all" || userId === ctx.user.id) ? memberName.get(userId) ?? null : null);

  let sale: CommissionDetail["sale"] = null;
  if (c.sale_id) {
    const { data: saleRow } = await service.from("sales").select("id, contact_id, product_variant_id, sale_date, financing_type").eq("id", c.sale_id).eq("workspace_id", ws).maybeSingle();
    const s = saleRow as { id: string; contact_id: string | null; product_variant_id: string | null; sale_date: string | null; financing_type: string | null } | null;
    if (s) {
      const links = await loadSaleLinks(service, ws, [s.id]);
      const names = await loadNames(service, ws, links);
      const link = links.get(s.id);
      sale = {
        id: s.id,
        contactId: s.contact_id,
        contactName: s.contact_id ? names.contacts.get(s.contact_id) ?? null : null,
        productName: link?.product_id ? names.products.get(link.product_id) ?? null : null,
        variantName: s.product_variant_id ? names.variants.get(s.product_variant_id) ?? null : null,
        saleDate: s.sale_date,
        financingType: s.financing_type,
      };
    }
  }

  let payment: CommissionDetail["payment"] = null;
  if (c.payment_id) {
    const { data: paymentRow } = await service.from("payments").select("id, type, status, paid_on, payment_method, amount, provider_fee_amount").eq("id", c.payment_id).eq("workspace_id", ws).maybeSingle();
    const p = paymentRow as { id: string; type: string; status: string; paid_on: string | null; payment_method: string | null; amount: unknown; provider_fee_amount: unknown } | null;
    if (p) {
      payment = {
        id: p.id, type: p.type, status: p.status, paidOn: p.paid_on, method: p.payment_method,
        amountCents: scope === "all" ? toCents(p.amount) : null,
        feeCents: scope === "all" && p.provider_fee_amount !== null && p.provider_fee_amount !== undefined ? toCents(p.provider_fee_amount) : null,
      };
    }
  }

  let touch: CommissionDetail["attribution"]["touch"] = null;
  if (scope === "all" && c.attribution_touch_id) {
    const { data: touchRow } = await ctx.supabase
      .from("contact_touches")
      .select("id, channel, source, medium, campaign, content_label, term, origin, occurred_at")
      .eq("id", c.attribution_touch_id)
      .eq("workspace_id", ws)
      .maybeSingle();
    const t = touchRow as { id: string; channel: string | null; source: string | null; medium: string | null; campaign: string | null; content_label: string | null; term: string | null; origin: string | null; occurred_at: string } | null;
    if (t) touch = { id: t.id, channel: t.channel, source: t.source, medium: t.medium, campaign: t.campaign, content: t.content_label, term: t.term, origin: t.origin, occurredAt: t.occurred_at };
  }

  // La regla de hoy: la RLS de `commission_rules` decide quién la ve (Member de alcance `own`: nadie).
  let current: CommissionRule | null = null;
  if (c.rule_id) {
    const { data: ruleRow } = await ctx.supabase.from("commission_rules").select(RULE_COLUMNS).eq("id", c.rule_id).eq("workspace_id", ws).maybeSingle();
    current = ruleRow ? commissionRuleFromRow(ruleRow as unknown as Record<string, unknown>) : null;
  }
  const used = asRecord(c.rule_snapshot);

  return {
    id: c.id,
    kind: c.kind,
    role: c.role,
    roleName: c.role ? settings?.roles.find((r) => r.key === c.role)?.name ?? c.role : null,
    userId: scope === "all" || c.user_id === ctx.user.id ? c.user_id : null,
    userName: showPerson(c.user_id),
    amountCents: toCents(c.amount),
    baseCents: c.base_amount === null || c.base_amount === undefined ? null : toCents(c.base_amount),
    paidOn: c.paid_on,
    availableOn: c.available_on,
    notes: c.notes,
    voidedAt: c.voided_at,
    voidReason: c.void_reason,
    voidedByName: scope === "all" && c.voided_by ? memberName.get(c.voided_by) ?? null : null,
    createdAt: c.created_at,
    createdByName: scope === "all" && c.created_by ? memberName.get(c.created_by) ?? null : null,
    expense,
    status,
    notSelectable: selectableReasonCode(c, expense ? { status: expense.status, scheduled_date: expense.scheduled_date, paid_date: expense.paid_date } : null, f.todayLocal),
    sale,
    payment,
    attribution: { snapshot: asRecord(c.attribution_snapshot), touch },
    rule: { used, current, comparison: compareRuleSnapshot(used, current) },
    scope,
    canManage: ctx.can("commissions.manage"),
    canPayout: ctx.can("commissions.manage") && ctx.can("expenses.manage"),
    today: f.todayLocal,
    tz: f.tz,
  };
}

// ── La pantalla de reglas ──────────────────────────────────────────────

export interface RulesScreenData {
  roles: CommissionRole[];
  /** Las reglas vivas de cada rol, en orden de prioridad, con su frase, su estado y el aviso «nunca se usa». */
  rules: Record<string, RuleView[]>;
  lookups: DescribeLookups;
  /** Con qué se arma el editor. */
  editor: {
    products: Array<{ id: string; name: string; status: string; archived: boolean }>;
    variants: Array<{ id: string; productId: string; name: string; archived: boolean }>;
    members: Array<{ id: string; name: string }>;
    methods: Array<{ key: string; name: string; active: boolean }>;
    /** Los valores UTM que de verdad entraron en los últimos 90 días (hasta 20 por dimensión). */
    utm: UtmSuggestions;
  };
  today: string;
  tz: string;
  loadError: boolean;
}

const UTM_WINDOW_DAYS = 90;

export async function loadRulesScreen(ctx: Ctx): Promise<RulesScreenData | null> {
  if (!ctx.can("commissions.manage")) return null;
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  const service = await createServiceClient();
  const since = new Date(Date.parse(`${addDays(f.todayLocal, -UTM_WINDOW_DAYS)}T00:00:00Z`)).toISOString();

  const [settings, rulesRes, members, products, variants, touches] = await Promise.all([
    readCommissionSettings(service, ws),
    ctx.supabase.from("commission_rules").select(RULE_COLUMNS).eq("workspace_id", ws).is("archived_at", null).order("position", { ascending: true }).limit(2000),
    getWorkspaceMembers(ws),
    service.from("products").select("id, name, status, archived_at").eq("workspace_id", ws).order("name", { ascending: true }).limit(500),
    service.from("product_variants").select("id, product_id, name, archived_at").eq("workspace_id", ws).order("name", { ascending: true }).limit(2000),
    fetchAllPages<{ source: string | null; medium: string | null; campaign: string | null; content_label: string | null; term: string | null }>(
      (from, to) =>
        ctx.supabase.from("contact_touches").select("source, medium, campaign, content_label, term").eq("workspace_id", ws).gte("occurred_at", since).order("occurred_at", { ascending: false }).range(from, to) as unknown as PromiseLike<{
          data: Array<{ source: string | null; medium: string | null; campaign: string | null; content_label: string | null; term: string | null }> | null;
          error: { message: string } | null;
        }>,
      { maxRows: 5000 },
    ),
  ]);
  if (rulesRes.error) console.error("[comisiones] no pude leer las reglas:", rulesRes.error.message);
  if (touches.error) console.error("[comisiones] no pude leer los UTM:", touches.error);

  const roles = settings?.roles ?? [];
  const rules = ((rulesRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(commissionRuleFromRow);
  const methods = workspaceMethods({ payment_methods: settings?.paymentMethods }).configs;

  const referenced = {
    posts: uniq(rules.flatMap((r) => r.conditions.content_post_ids ?? [])),
    campaigns: uniq(rules.flatMap((r) => r.conditions.meta_campaign_ids ?? [])),
    ads: uniq(rules.flatMap((r) => r.conditions.meta_ad_ids ?? [])),
  };
  const posts: Record<string, string> = {};
  const metaCampaigns: Record<string, string> = {};
  const metaAds: Record<string, string> = {};
  const lookups: DescribeLookups = {
    roles: Object.fromEntries(roles.map((r) => [r.key, r.name])),
    products: Object.fromEntries(((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])),
    variants: Object.fromEntries(((variants.data ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name])),
    people: Object.fromEntries(members.map((m) => [m.userId, m.name])),
    methods: Object.fromEntries(methods.map((m) => [m.key, m.name])),
    posts,
    metaCampaigns,
    metaAds,
  };
  if (referenced.posts.length) {
    const { data } = await service.from("content_posts").select("id, title").eq("workspace_id", ws).in("id", referenced.posts.slice(0, 100));
    for (const row of (data ?? []) as Array<{ id: string; title: string }>) posts[row.id] = row.title;
  }
  if (referenced.campaigns.length) {
    const { data } = await service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).in("campaign_id", referenced.campaigns.slice(0, 100));
    for (const row of (data ?? []) as Array<{ campaign_id: string; name: string | null }>) if (row.name) metaCampaigns[row.campaign_id] = row.name;
  }
  if (referenced.ads.length) {
    const { data } = await service.from("meta_ads").select("ad_id, name").eq("workspace_id", ws).in("ad_id", referenced.ads.slice(0, 100));
    for (const row of (data ?? []) as Array<{ ad_id: string; name: string | null }>) if (row.name) metaAds[row.ad_id] = row.name;
  }

  return {
    roles,
    rules: buildRuleViews(roles, rules, lookups, f.todayLocal),
    lookups,
    editor: {
      products: ((products.data ?? []) as Array<{ id: string; name: string; status: string; archived_at: string | null }>).map((p) => ({ id: p.id, name: p.name, status: p.status, archived: !!p.archived_at })),
      variants: ((variants.data ?? []) as Array<{ id: string; product_id: string; name: string; archived_at: string | null }>).map((v) => ({ id: v.id, productId: v.product_id, name: v.name, archived: !!v.archived_at })),
      members: members.map((m) => ({ id: m.userId, name: m.name })),
      methods: methods.map((m) => ({ key: m.key, name: m.name, active: m.active })),
      utm: utmSuggestions(touches.rows),
    },
    today: f.todayLocal,
    tz: f.tz,
    loadError: !!rulesRes.error || !settings,
  };
}
