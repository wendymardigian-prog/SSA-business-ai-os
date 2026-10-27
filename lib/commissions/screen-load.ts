/**
 * Lo que la pantalla de Comisiones necesita además de `list-load.ts` (SOLO servidor): las columnas «Pago» y
 * «% o fijo» de la página, la línea de «Mis comisiones», las filas del CSV, la selección de todo el filtro y las
 * listas de comisiones que se ven dentro de una venta o de un gasto.
 *
 * Quién lee qué (igual que `list-load.ts`):
 *   - `commissions` se lee con la SESIÓN de quien mira: la RLS decide qué ve cada quien.
 *   - Los gastos (solo `{ estado, fechas }`), las ventas, los pagos y los nombres, con el cliente de SERVICIO,
 *     filtrando siempre por el workspace de la sesión y solo para las filas que la RLS ya dejó pasar.
 * Nada de lo que trae el cliente (ids de la URL) se da por bueno: se valida la forma y se filtra por workspace.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { financeContextOf } from "@/lib/finance/context";
import { expenseStatusLabel } from "@/lib/finance/expense-status";
import { fetchAllPages } from "@/lib/finance/paginate";
import { monthStart } from "@/lib/finance/dates";
import { toCents } from "@/lib/shared/money";
import { FINANCING_TYPE_LABELS, type FinancingType } from "@/lib/sales/labels";
import { paymentMethodName } from "@/lib/sales/payment-methods";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import type { CommissionExportRow } from "./export-csv";
import { paidRange, type CommissionFilters } from "./filters";
import { COMMISSIONS_LOAD_LIMIT, type CommissionListRow } from "./list-load";
import { applyDerivedFilters, classifyRows, sortRows, type ClassifiedRow, type ExpenseRef, type LightCommission, type SaleLink } from "./list-model";
import { mineSummary, type MineSummary } from "./mine";
import { buildRelatedCommissions, type RelatedCommissionList } from "./related-lists";
import { calcLabel, paymentLabel, paymentPositions, type NumberablePayment } from "./row-labels";
import { selectableReasonCode, type SelectedCommission } from "./selection";
import { readCommissionSettings } from "./server-refs";

type Service = Awaited<ReturnType<typeof createServiceClient>>;
type Ctx = Pick<PermissionContext, "supabase" | "workspace" | "user" | "can" | "scope">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIGHT_COLUMNS = "id, kind, role, user_id, payment_id, sale_id, rule_id, amount, base_amount, paid_on, available_on, expense_id, voided_at, created_at";

const chunk = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const uniq = <T>(list: ReadonlyArray<T | null | undefined>): T[] => [...new Set(list.filter((v): v is T => v !== null && v !== undefined))];
const scopeOf = (ctx: Ctx): "own" | "all" => (ctx.scope("commissions") === "all" ? "all" : "own");

// ── Piezas de lectura ──────────────────────────────────────────────────

/** De cada gasto, SOLO lo que el estado de una comisión necesita. */
async function expenseRefs(service: Service, workspaceId: string, ids: readonly string[]): Promise<Map<string, ExpenseRef>> {
  const out = new Map<string, ExpenseRef>();
  for (const part of chunk(uniq(ids), 100)) {
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

interface SaleBits {
  contactId: string | null;
  contactName: string | null;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  financing: string | null;
}

/** Contacto, producto y financiamiento de cada venta (el producto sale de la variante, como en la lista). */
async function saleBits(service: Service, workspaceId: string, saleIds: readonly string[]): Promise<Map<string, SaleBits>> {
  const sales = new Map<string, { contact_id: string | null; product_variant_id: string | null; financing_type: string | null }>();
  for (const part of chunk(uniq(saleIds), 100)) {
    const { data, error } = await service.from("sales").select("id, contact_id, product_variant_id, financing_type").eq("workspace_id", workspaceId).in("id", part);
    if (error) {
      console.error("[comisiones] no pude leer las ventas:", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: string; contact_id: string | null; product_variant_id: string | null; financing_type: string | null }>) sales.set(row.id, row);
  }
  const variants = new Map<string, { product_id: string; name: string }>();
  for (const part of chunk(uniq([...sales.values()].map((s) => s.product_variant_id)), 100)) {
    const { data } = await service.from("product_variants").select("id, product_id, name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; product_id: string; name: string }>) variants.set(row.id, row);
  }
  const products = new Map<string, string>();
  for (const part of chunk(uniq([...variants.values()].map((v) => v.product_id)), 100)) {
    const { data } = await service.from("products").select("id, name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) products.set(row.id, row.name);
  }
  const contacts = new Map<string, string>();
  for (const part of chunk(uniq([...sales.values()].map((s) => s.contact_id)), 100)) {
    const { data } = await service.from("contacts").select("id, display_name").eq("workspace_id", workspaceId).in("id", part);
    for (const row of (data ?? []) as Array<{ id: string; display_name: string | null }>) contacts.set(row.id, row.display_name?.trim() || "Sin nombre");
  }
  const out = new Map<string, SaleBits>();
  for (const [id, sale] of sales) {
    const variant = sale.product_variant_id ? variants.get(sale.product_variant_id) ?? null : null;
    out.set(id, {
      contactId: sale.contact_id,
      contactName: sale.contact_id ? contacts.get(sale.contact_id) ?? null : null,
      productId: variant?.product_id ?? null,
      productName: variant ? products.get(variant.product_id) ?? null : null,
      variantName: variant?.name ?? null,
      financing: sale.financing_type ? FINANCING_TYPE_LABELS[sale.financing_type as FinancingType] ?? sale.financing_type : null,
    });
  }
  return out;
}

const asLink = (bits: ReadonlyMap<string, SaleBits>): Map<string, SaleLink> =>
  new Map([...bits].map(([id, b]) => [id, { contact_id: b.contactId, product_id: b.productId }]));

interface PaymentBits {
  type: string;
  method: string | null;
  amountCents: number;
  feeCents: number | null;
  number: number | null;
  total: number;
}

/** Los pagos de las ventas dadas, con su número entre los de la venta («Cuota 2 de 6»). */
async function paymentBits(service: Service, workspaceId: string, saleIds: readonly string[], methodDefs: ReturnType<typeof workspaceMethods>["defs"]): Promise<Map<string, PaymentBits & { methodName: string | null }>> {
  const rows: Array<NumberablePayment & { payment_method: string | null; amount: unknown; provider_fee_amount: unknown }> = [];
  for (const part of chunk(uniq(saleIds), 50)) {
    const { data, error } = await service
      .from("payments")
      .select("id, sale_id, type, status, original_due_date, due_date, created_at, payment_method, amount, provider_fee_amount")
      .eq("workspace_id", workspaceId)
      .in("sale_id", part)
      .limit(2000);
    if (error) {
      console.error("[comisiones] no pude leer los pagos:", error.message);
      continue;
    }
    rows.push(...((data ?? []) as unknown as typeof rows));
  }
  const positions = paymentPositions(rows);
  const out = new Map<string, PaymentBits & { methodName: string | null }>();
  for (const p of rows) {
    const pos = positions.get(p.id);
    out.set(p.id, {
      type: p.type,
      method: p.payment_method,
      methodName: p.payment_method ? paymentMethodName(p.payment_method, methodDefs) : null,
      amountCents: toCents(p.amount),
      feeCents: p.provider_fee_amount === null || p.provider_fee_amount === undefined ? null : toCents(p.provider_fee_amount),
      number: pos?.number ?? null,
      total: pos?.total ?? 0,
    });
  }
  return out;
}

// ── Columnas «Pago» y «% o fijo» de la página ──────────────────────────

export interface RowExtra {
  /** «Cuota 2 de 6». */
  payment: string;
  /** «8 % del neto». */
  calc: string | null;
}

export type RowExtras = Record<string, RowExtra>;

/** Lo que falta para pintar las filas de una página: el pago de cada una y cómo se calculó. Nunca lanza. */
export async function loadRowExtras(ctx: Ctx, rows: ReadonlyArray<Pick<CommissionListRow, "id" | "paymentId" | "saleId">>): Promise<RowExtras> {
  const out: RowExtras = {};
  if (rows.length === 0) return out;
  const ws = ctx.workspace.id;
  try {
    const service = await createServiceClient();
    const [payments, snapshots] = await Promise.all([
      paymentBits(service, ws, rows.map((r) => r.saleId).filter((id): id is string => !!id), workspaceMethods(ctx.workspace).defs),
      ctx.supabase.from("commissions").select("id, rule_snapshot").eq("workspace_id", ws).in("id", rows.map((r) => r.id)),
    ]);
    const calc = new Map(((snapshots.data ?? []) as unknown as Array<{ id: string; rule_snapshot: unknown }>).map((r) => [r.id, calcLabel(r.rule_snapshot)]));
    for (const row of rows) {
      const p = row.paymentId ? payments.get(row.paymentId) ?? null : null;
      out[row.id] = { payment: paymentLabel(p ? { type: p.type, number: p.number, total: p.total } : null), calc: calc.get(row.id) ?? null };
    }
  } catch (e) {
    console.error("[comisiones] no pude armar las columnas de pago:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

export interface DrawerExtras {
  /** `sales.status` de la venta (para el chip «Venta cancelada»). */
  saleStatus: string | null;
  /** «Cuota 2 de 6». */
  installment: string | null;
  methodName: string | null;
}

/** Lo que la ficha muestra de la venta y del pago y `loadCommissionDetail` no trae: el estado de la venta y el lugar del pago entre sus cuotas. Nunca lanza. */
export async function loadDrawerExtras(ctx: Ctx, ids: { saleId: string | null; paymentId: string | null }): Promise<DrawerExtras> {
  const out: DrawerExtras = { saleStatus: null, installment: null, methodName: null };
  if (!ids.saleId) return out;
  const ws = ctx.workspace.id;
  try {
    const service = await createServiceClient();
    const [sale, payments] = await Promise.all([
      service.from("sales").select("status").eq("id", ids.saleId).eq("workspace_id", ws).maybeSingle(),
      ids.paymentId ? paymentBits(service, ws, [ids.saleId], workspaceMethods(ctx.workspace).defs) : Promise.resolve(new Map<string, PaymentBits & { methodName: string | null }>()),
    ]);
    out.saleStatus = (sale.data as { status?: string } | null)?.status ?? null;
    const p = ids.paymentId ? payments.get(ids.paymentId) ?? null : null;
    if (p) {
      out.installment = paymentLabel({ type: p.type, number: p.number, total: p.total });
      out.methodName = p.methodName;
    }
  } catch (e) {
    console.error("[comisiones] no pude leer la venta y el pago de la ficha:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

// ── «Mis comisiones» ───────────────────────────────────────────────────

/** Lo generado y lo pagado este mes por la persona que mira (la RLS ya limita a las suyas). Nunca lanza. */
export async function loadMineSummary(ctx: Ctx): Promise<MineSummary | null> {
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  try {
    const start = monthStart(f.todayLocal.slice(0, 7));
    const fetched = await fetchAllPages<LightCommission>(
      (from, to) =>
        ctx.supabase
          .from("commissions")
          .select(LIGHT_COLUMNS)
          .eq("workspace_id", ws)
          .is("voided_at", null)
          .or(`expense_id.not.is.null,paid_on.gte.${start}`)
          .order("created_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: LightCommission[] | null; error: { message: string } | null }>,
      { maxRows: COMMISSIONS_LOAD_LIMIT },
    );
    if (fetched.error) {
      console.error("[comisiones] no pude leer el resumen del mes:", fetched.error);
      return null;
    }
    const service = await createServiceClient();
    const expenses = await expenseRefs(service, ws, fetched.rows.map((r) => r.expense_id).filter((id): id is string => !!id));
    return mineSummary(classifyRows(fetched.rows, expenses, new Map(), f.todayLocal), f.todayLocal);
  } catch (e) {
    console.error("[comisiones] no pude armar el resumen del mes:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ── Todo el filtro (CSV y «Seleccionar todo el filtro») ────────────────

type Builder = {
  eq: (column: string, value: string) => Builder;
  in: (column: string, values: readonly string[]) => Builder;
  gte: (column: string, value: string) => Builder;
  lte: (column: string, value: string) => Builder;
};

function pushdown<T>(query: T, filters: CommissionFilters, saleIds: readonly string[] | null): T {
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

export interface FilteredCommissions {
  rows: ClassifiedRow[];
  /** Había más filas que el tope: se tomaron las más nuevas. */
  truncated: boolean;
  bits: Map<string, SaleBits>;
  expenses: Map<string, ExpenseRef>;
  today: string;
}

/** TODAS las filas del filtro (sin paginar), clasificadas y ordenadas como la lista. Con la sesión: la RLS decide. */
export async function loadFilteredCommissions(ctx: Ctx, filters: CommissionFilters): Promise<FilteredCommissions | null> {
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  const service = await createServiceClient();

  let saleIds: string[] | null = null;
  if (filters.contactId) {
    const { data } = await service.from("sales").select("id").eq("workspace_id", ws).eq("contact_id", filters.contactId).limit(1000);
    saleIds = ((data ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (saleIds.length === 0) return { rows: [], truncated: false, bits: new Map(), expenses: new Map(), today: f.todayLocal };
  }

  const fetched = await fetchAllPages<LightCommission>(
    (from, to) =>
      pushdown(ctx.supabase.from("commissions").select(LIGHT_COLUMNS).eq("workspace_id", ws), filters, saleIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LightCommission[] | null; error: { message: string } | null }>,
    { maxRows: COMMISSIONS_LOAD_LIMIT + 1 },
  );
  if (fetched.error) {
    console.error("[comisiones] no pude leer las comisiones del filtro:", fetched.error);
    return null;
  }
  const truncated = fetched.truncated || fetched.rows.length > COMMISSIONS_LOAD_LIMIT;
  const light = fetched.rows.slice(0, COMMISSIONS_LOAD_LIMIT);

  const [expenses, bits] = await Promise.all([
    expenseRefs(service, ws, light.map((r) => r.expense_id).filter((id): id is string => !!id)),
    saleBits(service, ws, light.map((r) => r.sale_id).filter((id): id is string => !!id)),
  ]);
  const classified = classifyRows(light, expenses, asLink(bits), f.todayLocal);
  const matched = sortRows(applyDerivedFilters(classified, { statuses: filters.statuses, pill: filters.pill, products: filters.products, contactId: null }, f.todayLocal));
  return { rows: matched, truncated, bits, expenses, today: f.todayLocal };
}

/**
 * Las comisiones del filtro que se pueden pasar a un gasto (hasta `limit`), con lo que el modal necesita para
 * las cuentas. `total` es cuántas filas tiene el filtro; `selectable`, cuántas se pueden pagar.
 */
export async function loadSelectableCommissions(ctx: Ctx, filters: CommissionFilters, limit: number): Promise<{ items: SelectedCommission[]; total: number; selectable: number; truncated: boolean } | null> {
  const all = await loadFilteredCommissions(ctx, filters);
  if (!all) return null;
  const selectable = all.rows.filter((r) =>
    selectableReasonCode(r.commission, r.expense ? { status: r.expense.status, scheduled_date: r.expense.scheduled_date, paid_date: r.expense.paid_date } : null, all.today) === null,
  );
  return {
    items: selectable.slice(0, limit).map((r) => ({ id: r.commission.id, userId: r.commission.user_id, amountCents: r.amountCents, paidOn: r.commission.paid_on })),
    total: all.rows.length,
    selectable: selectable.length,
    truncated: all.truncated,
  };
}

/** Las filas del CSV: lo mismo que la lista, completo, hasta el tope. `own` no ve lo cobrado ni la comisión del procesador. */
export async function loadCommissionExport(ctx: Ctx, filters: CommissionFilters): Promise<{ rows: CommissionExportRow[]; truncated: boolean } | null> {
  const ws = ctx.workspace.id;
  const scope = scopeOf(ctx);
  const all = await loadFilteredCommissions(ctx, filters);
  if (!all) return null;
  const service = await createServiceClient();
  const ids = all.rows.map((r) => r.commission.id);

  const extras = new Map<string, { rule_snapshot: unknown; attribution_snapshot: unknown; notes: string | null }>();
  for (const part of chunk(ids, 100)) {
    const { data } = await ctx.supabase.from("commissions").select("id, rule_snapshot, attribution_snapshot, notes").eq("workspace_id", ws).in("id", part);
    for (const row of (data ?? []) as unknown as Array<{ id: string; rule_snapshot: unknown; attribution_snapshot: unknown; notes: string | null }>) extras.set(row.id, row);
  }
  const [settings, members, payments] = await Promise.all([
    readCommissionSettings(service, ws),
    getWorkspaceMembers(ws),
    paymentBits(service, ws, uniq(all.rows.map((r) => r.commission.sale_id)), workspaceMethods(ctx.workspace).defs),
  ]);
  const roleName = new Map((settings?.roles ?? []).map((r) => [r.key, r.name]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const rows = all.rows.map<CommissionExportRow>((r) => {
    const c = r.commission;
    const extra = extras.get(c.id);
    const rule = extra?.rule_snapshot && typeof extra.rule_snapshot === "object" ? (extra.rule_snapshot as Record<string, unknown>) : null;
    const attr = extra?.attribution_snapshot && typeof extra.attribution_snapshot === "object" ? (extra.attribution_snapshot as Record<string, unknown>) : null;
    const sale = c.sale_id ? all.bits.get(c.sale_id) ?? null : null;
    const pay = c.payment_id ? payments.get(c.payment_id) ?? null : null;
    const showPerson = scope === "all" || c.user_id === ctx.user.id;
    return {
      id: c.id,
      paidOn: c.paid_on,
      personName: showPerson && c.user_id ? memberName.get(c.user_id) ?? null : null,
      roleName: c.role ? roleName.get(c.role) ?? c.role : c.kind === "adjustment" ? "Ajuste" : null,
      contactName: sale?.contactName ?? null,
      productName: sale?.productName ?? null,
      financing: sale?.financing ?? null,
      paymentNumber: pay?.number ?? null,
      method: pay?.methodName ?? null,
      collectedCents: scope === "all" && pay ? pay.amountCents : null,
      feeCents: scope === "all" && pay ? pay.feeCents : null,
      baseCents: c.base_amount === null || c.base_amount === undefined ? null : toCents(c.base_amount),
      calc: calcLabel(rule),
      amountCents: r.amountCents,
      ruleName: text(rule?.name),
      statusLabel: r.status.label,
      expenseStatusLabel: r.expense ? expenseStatusLabel(r.expense.status) : null,
      expenseDate: r.expense ? r.expense.paid_date ?? r.expense.scheduled_date : null,
      channel: text(attr?.channel),
      pieceOrAd: text(attr?.content_title) ?? text(attr?.ad_name),
      notes: extra?.notes ?? null,
    };
  });
  return { rows, truncated: all.truncated };
}

// ── Dentro de una venta o de un gasto (F62) ────────────────────────────

/** Las comisiones de una venta, para su ficha. `null` si quien mira no tiene `commissions.view`. La RLS decide cuáles ve. */
export async function loadSaleCommissions(ctx: Ctx, saleId: string): Promise<RelatedCommissionList | null> {
  if (!ctx.can("commissions.view") || !UUID_RE.test(saleId)) return null;
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  try {
    const { data, error } = await ctx.supabase.from("commissions").select(LIGHT_COLUMNS).eq("workspace_id", ws).eq("sale_id", saleId).order("created_at", { ascending: true }).limit(200);
    if (error) {
      console.error("[comisiones] no pude leer las comisiones de la venta:", error.message);
      return null;
    }
    const light = (data ?? []) as unknown as LightCommission[];
    const service = await createServiceClient();
    const [expenses, settings, members] = await Promise.all([
      expenseRefs(service, ws, light.map((r) => r.expense_id).filter((id): id is string => !!id)),
      readCommissionSettings(service, ws),
      getWorkspaceMembers(ws),
    ]);
    const showAll = scopeOf(ctx) === "all";
    return buildRelatedCommissions(classifyRows(light, expenses, new Map(), f.todayLocal), {
      people: new Map(members.filter((m) => showAll || m.userId === ctx.user.id).map((m) => [m.userId, m.name])),
      roles: new Map((settings?.roles ?? []).map((r) => [r.key, r.name])),
    });
  } catch (e) {
    console.error("[comisiones] no pude armar las comisiones de la venta:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** El tope de comisiones que se listan en la ficha de un gasto de liquidación. */
export const EXPENSE_COMMISSIONS_LIMIT = 500;

/**
 * Las comisiones de un gasto de liquidación: las que están hoy en el gasto y las que tuvo cuando se creó
 * (`source_ref.commission_ids`: si el gasto se anuló, vuelven a Pendiente y siguen listadas). Se llama DESPUÉS de
 * `expenses.view` y devuelve solo persona, venta, monto y estado.
 */
export async function loadExpenseCommissions(ctx: Pick<PermissionContext, "workspace">, expense: { id: string; origin: string; source_ref: unknown }): Promise<RelatedCommissionList | null> {
  if (expense.origin !== "commission_payout" || !UUID_RE.test(expense.id)) return null;
  const ws = ctx.workspace.id;
  const f = financeContextOf(ctx);
  try {
    const ref = expense.source_ref && typeof expense.source_ref === "object" ? (expense.source_ref as { commission_ids?: unknown }) : {};
    const original = Array.isArray(ref.commission_ids) ? ref.commission_ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, EXPENSE_COMMISSIONS_LIMIT) : [];
    const service = await createServiceClient();

    const found = new Map<string, LightCommission>();
    const linked = await service.from("commissions").select(LIGHT_COLUMNS).eq("workspace_id", ws).eq("expense_id", expense.id).limit(EXPENSE_COMMISSIONS_LIMIT);
    if (linked.error) {
      console.error("[comisiones] no pude leer las comisiones del gasto:", linked.error.message);
      return null;
    }
    for (const row of (linked.data ?? []) as unknown as LightCommission[]) found.set(row.id, row);
    for (const part of chunk(original.filter((id) => !found.has(id)), 100)) {
      const { data } = await service.from("commissions").select(LIGHT_COLUMNS).eq("workspace_id", ws).in("id", part);
      for (const row of (data ?? []) as unknown as LightCommission[]) found.set(row.id, row);
    }
    const light = [...found.values()];
    if (light.length === 0) return buildRelatedCommissions([], { people: new Map(), roles: new Map() });

    const [expenses, bits, settings, members] = await Promise.all([
      expenseRefs(service, ws, [expense.id]),
      saleBits(service, ws, light.map((r) => r.sale_id).filter((id): id is string => !!id)),
      readCommissionSettings(service, ws),
      getWorkspaceMembers(ws),
    ]);
    return buildRelatedCommissions(classifyRows(light, expenses, asLink(bits), f.todayLocal), {
      people: new Map(members.map((m) => [m.userId, m.name])),
      roles: new Map((settings?.roles ?? []).map((r) => [r.key, r.name])),
      contacts: new Map([...bits.values()].filter((b) => b.contactId && b.contactName).map((b) => [b.contactId as string, b.contactName as string])),
    });
  } catch (e) {
    console.error("[comisiones] no pude armar las comisiones del gasto:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
