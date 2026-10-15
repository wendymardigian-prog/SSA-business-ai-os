import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { commissionsToCsv } from "./export-csv";
import { emptyCommissionFilters, type CommissionFilters } from "./filters";
import { defaultCommissionRoles } from "./roles";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const SALE = "55555555-5555-4555-8555-555555555551";
const SALE_OTHER = "55555555-5555-4555-8555-555555555559";
const VAR = "88888888-8888-4888-8888-888888888881";
const PROD = "98888888-8888-4888-8888-888888888881";
const CONTACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EXP_PAID = "77777777-7777-4777-8777-777777777771";
const EXP_PROG = "77777777-7777-4777-8777-777777777772";
const PAY1 = "66666666-6666-4666-8666-666666666661";
const PAY2 = "66666666-6666-4666-8666-666666666662";
const PAY_REFUND = "66666666-6666-4666-8666-666666666663";

let db: MemoryDb;
let service: MemoryDb;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => service.client }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: ME, name: "Yo", role: "owner", email: "" },
    { userId: ANA, name: "Ana", role: "member", email: "" },
  ],
}));

const {
  loadRowExtras, loadMineSummary, loadCommissionExport, loadSelectableCommissions, loadSaleCommissions, loadExpenseCommissions, loadDrawerExtras,
} = await import("./screen-load");

type Ctx = Parameters<typeof loadSaleCommissions>[0];

function ctxFor(opts: { scope?: "all" | "own"; keys?: string[]; user?: string } = {}): Ctx {
  const keys = new Set(opts.keys ?? ["commissions.view", "commissions.manage", "expenses.manage"]);
  return {
    supabase: db.client,
    user: { id: opts.user ?? ME },
    workspace: { id: WS, timezone: "UTC", payment_methods: null },
    can: (key: string) => keys.has(key),
    scope: () => opts.scope ?? "all",
  } as unknown as Ctx;
}

let n = 0;
const commission = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    id: `c${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`, workspace_id: WS, kind: "earned", role: "vendedor", user_id: ME, payment_id: PAY1, sale_id: SALE, rule_id: "r",
    amount: 38.82, base_amount: 485.2, paid_on: "2026-10-10", available_on: "2026-10-10", expense_id: null, voided_at: null,
    created_at: `2026-10-10T10:00:${String(n % 60).padStart(2, "0")}Z`,
    rule_snapshot: { name: "Vendedor 8 %", calc_type: "percent", rate: 8, base: "net_of_fees" },
    attribution_snapshot: { channel: "organic", source: "instagram", content_title: "Reel de octubre", ad_name: null },
    notes: null, void_reason: null, ...over,
  };
};

const filters = (patch: Partial<CommissionFilters> = {}): CommissionFilters => ({ ...emptyCommissionFilters(), ...patch });

function setup(commissions: Array<Record<string, unknown>>) {
  db = memoryDb({
    commissions,
    expenses: [
      { id: EXP_PAID, workspace_id: WS, status: "pagado", scheduled_date: "2026-10-12", paid_date: "2026-10-13", concept: "Comisiones de Yo", amount: 500, notes: "privado", origin: "commission_payout" },
      { id: EXP_PROG, workspace_id: WS, status: "programado", scheduled_date: "2026-10-20", paid_date: null, concept: "Otro", amount: 80, notes: "privado", origin: "commission_payout" },
    ],
    sales: [
      { id: SALE, workspace_id: WS, contact_id: CONTACT, product_variant_id: VAR, financing_type: "installments", status: "paid" },
      { id: SALE_OTHER, workspace_id: OTHER_WS, contact_id: "zz", product_variant_id: null, financing_type: "full", status: "paid" },
    ],
    product_variants: [{ id: VAR, workspace_id: WS, product_id: PROD, name: "Mensual" }],
    products: [{ id: PROD, workspace_id: WS, name: "Mentoría" }],
    contacts: [{ id: CONTACT, workspace_id: WS, display_name: "Lucía Pérez" }],
    payments: [
      { id: PAY1, workspace_id: WS, sale_id: SALE, type: "installment", status: "paid", amount: 500, provider_fee_amount: 14.8, payment_method: "whop", original_due_date: null, due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z" },
      { id: PAY2, workspace_id: WS, sale_id: SALE, type: "installment", status: "scheduled", amount: 500, provider_fee_amount: null, payment_method: null, original_due_date: null, due_date: "2026-11-01", created_at: "2026-09-01T00:00:01Z" },
      { id: PAY_REFUND, workspace_id: WS, sale_id: SALE, type: "refund", status: "paid", amount: -100, provider_fee_amount: null, payment_method: null, original_due_date: null, due_date: "2026-10-12", created_at: "2026-10-12T00:00:00Z" },
    ],
    workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() }, payment_methods: null }],
  });
  service = db;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  setup([]);
});
afterEach(() => vi.useRealTimers());

describe("loadRowExtras", () => {
  it("dice «Cuota 1 de 2» y cómo se calculó cada fila", async () => {
    const c = commission();
    setup([c]);
    const extras = await loadRowExtras(ctxFor(), [{ id: c.id, paymentId: PAY1, saleId: SALE }]);
    expect(extras[c.id]).toEqual({ payment: "Cuota 1 de 2", calc: "8 % del neto" });
  });

  it("un ajuste sin pago ni regla es un guion, y un reembolso se llama así", async () => {
    const adj = commission({ kind: "adjustment", role: null, payment_id: null, sale_id: null, rule_snapshot: null, amount: -4 });
    const onRefund = commission({ kind: "adjustment", payment_id: PAY_REFUND, rule_snapshot: null, amount: -4 });
    setup([adj, onRefund]);
    const extras = await loadRowExtras(ctxFor(), [
      { id: adj.id, paymentId: null, saleId: null },
      { id: onRefund.id, paymentId: PAY_REFUND, saleId: SALE },
    ]);
    expect(extras[adj.id]).toEqual({ payment: "—", calc: null });
    expect(extras[onRefund.id]).toEqual({ payment: "Reembolso", calc: null });
  });

  it("sin filas no lee nada", async () => {
    expect(await loadRowExtras(ctxFor(), [])).toEqual({});
  });
});

describe("loadMineSummary", () => {
  it("suma lo generado y lo pagado este mes de quien mira", async () => {
    setup([
      commission({ amount: 300 }),
      commission({ amount: 520, expense_id: EXP_PAID }),
      commission({ amount: 40, paid_on: "2026-09-20", expense_id: EXP_PAID }),
      commission({ amount: 99, expense_id: EXP_PROG }),
    ]);
    expect(await loadMineSummary(ctxFor({ scope: "own" }))).toEqual({ generatedCents: (300 + 520 + 99) * 100, paidCents: (520 + 40) * 100 });
  });
});

describe("loadSelectableCommissions", () => {
  it("devuelve solo lo que se puede pagar, con la persona y el monto, y cuenta cuántas tiene el filtro", async () => {
    setup([commission({ amount: 10 }), commission({ user_id: null }), commission({ expense_id: EXP_PROG }), commission({ voided_at: "2026-10-11T00:00:00Z" }), commission({ available_on: "2999-01-01" }), commission({ user_id: ANA, amount: 5 })]);
    const result = await loadSelectableCommissions(ctxFor(), filters(), 500);
    expect(result).toMatchObject({ total: 6, selectable: 2, truncated: false });
    expect(result?.items.map((i) => [i.userId, i.amountCents])).toEqual(expect.arrayContaining([[ME, 1000], [ANA, 500]]));
  });

  it("respeta el tope de ids", async () => {
    setup(Array.from({ length: 7 }, () => commission()));
    const result = await loadSelectableCommissions(ctxFor(), filters(), 3);
    expect(result?.items).toHaveLength(3);
    expect(result?.selectable).toBe(7);
  });

  it("respeta los filtros de la lista", async () => {
    setup([commission(), commission({ user_id: ANA }), commission({ role: "setter" })]);
    expect((await loadSelectableCommissions(ctxFor(), filters({ users: [ANA] }), 500))?.selectable).toBe(1);
    expect((await loadSelectableCommissions(ctxFor(), filters({ roles: ["setter"] }), 500))?.selectable).toBe(1);
  });
});

describe("loadCommissionExport", () => {
  it("arma las 21 columnas con persona, contacto, producto, pago y gasto", async () => {
    setup([commission({ expense_id: EXP_PAID })]);
    const result = await loadCommissionExport(ctxFor(), filters());
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({
      personName: "Yo", roleName: "Vendedor", contactName: "Lucía Pérez", productName: "Mentoría", financing: "Cuotas", paymentNumber: 1, collectedCents: 50000, feeCents: 1480,
      baseCents: 48520, calc: "8 % del neto", amountCents: 3882, ruleName: "Vendedor 8 %", statusLabel: "Pagada", expenseStatusLabel: "Pagado", expenseDate: "2026-10-13",
      channel: "organic", pieceOrAd: "Reel de octubre",
    });
    const csv = commissionsToCsv(result!.rows);
    expect(csv.split("\r\n")[1]).toContain(",500.00,14.80,485.20,8 % del neto,38.82,");
  });

  it("con alcance propio no entrega lo cobrado por el negocio ni la comisión del procesador, ni el nombre de otra persona", async () => {
    setup([commission(), commission({ user_id: ANA })]);
    const result = await loadCommissionExport(ctxFor({ scope: "own" }), filters());
    for (const row of result!.rows) expect(row).toMatchObject({ collectedCents: null, feeCents: null });
    const names = result!.rows.map((r) => r.personName);
    expect(names).toContain("Yo");
    expect(names).not.toContain("Ana");
    expect(commissionsToCsv(result!.rows)).not.toMatch(/500\.00|14\.80/);
  });

  it("un ajuste va con rol «Ajuste» y sin regla", async () => {
    setup([commission({ kind: "adjustment", role: null, rule_snapshot: null, payment_id: null, sale_id: null, amount: -19.41 })]);
    const result = await loadCommissionExport(ctxFor(), filters());
    expect(result?.rows[0]).toMatchObject({ roleName: "Ajuste", calc: null, ruleName: null, amountCents: -1941, contactName: null });
  });

  it("respeta el filtro (mismo que la lista)", async () => {
    setup([commission(), commission({ user_id: ANA }), commission({ voided_at: "2026-10-11T00:00:00Z" })]);
    expect((await loadCommissionExport(ctxFor(), filters({ users: [ANA] })))?.rows).toHaveLength(1);
    expect((await loadCommissionExport(ctxFor(), filters({ statuses: ["anulada"] })))?.rows).toHaveLength(1);
  });
});

describe("quién lee qué: las comisiones se leen con la SESIÓN (la RLS decide), no con el servicio", () => {
  // La sesión de un Member ve solo la suya; el cliente de servicio ve todas. Si un loader leyera `commissions` con el
  // servicio, estas pruebas verían tres filas en vez de una.
  function memberSees(mine: Record<string, unknown>) {
    const all = [mine, commission({ user_id: ANA, role: "setter" }), commission({ user_id: ANA, role: "contenido" })];
    setup(all);
    db = memoryDb({ commissions: [mine] });
  }

  it("el CSV de un Member trae solo las suyas", async () => {
    const mine = commission();
    memberSees(mine);
    const result = await loadCommissionExport(ctxFor({ scope: "own" }), filters());
    expect(result?.rows.map((r) => r.id)).toEqual([mine.id]);
  });

  it("«Seleccionar todo el filtro» y la lista de la venta tampoco se saltean la RLS", async () => {
    const mine = commission();
    memberSees(mine);
    expect((await loadSelectableCommissions(ctxFor({ scope: "own" }), filters(), 500))?.total).toBe(1);
    expect((await loadSaleCommissions(ctxFor({ scope: "own" }), SALE))?.items.map((i) => i.id)).toEqual([mine.id]);
  });

  it("el resumen de «Mis comisiones» sale de lo que la sesión ve", async () => {
    memberSees(commission({ amount: 12 }));
    expect(await loadMineSummary(ctxFor({ scope: "own" }))).toEqual({ generatedCents: 1200, paidCents: 0 });
  });
});

describe("loadSaleCommissions", () => {
  it("sin commissions.view no devuelve nada ni lee nada", async () => {
    setup([commission()]);
    expect(await loadSaleCommissions(ctxFor({ keys: ["sales.view"] }), SALE)).toBeNull();
  });

  it("lista las comisiones de la venta con persona, rol, monto y estado", async () => {
    setup([commission({ amount: 38.82 }), commission({ user_id: ANA, role: "setter", amount: 25 }), commission({ sale_id: SALE_OTHER }), commission({ voided_at: "2026-10-11T00:00:00Z", amount: 7 })]);
    const list = await loadSaleCommissions(ctxFor(), SALE);
    expect(list?.items.map((i) => [i.personName, i.roleName, i.amountCents, i.statusKey])).toEqual([
      ["Yo", "Vendedor", 3882, "pendiente"],
      ["Ana", "Setter", 2500, "pendiente"],
      ["Yo", "Vendedor", 700, "anulada"],
    ]);
    expect(list?.totalCents).toBe(3882 + 2500);
  });

  it("una venta sin comisiones da una lista vacía, y un id raro, nada", async () => {
    setup([]);
    expect(await loadSaleCommissions(ctxFor(), SALE)).toEqual({ items: [], totalCents: 0, liveCount: 0 });
    expect(await loadSaleCommissions(ctxFor(), "no-es-un-uuid")).toBeNull();
  });

  it("quien ve solo lo suyo no recibe el nombre de otra persona", async () => {
    setup([commission({ user_id: ANA, role: "setter" })]);
    const list = await loadSaleCommissions(ctxFor({ scope: "own" }), SALE);
    expect(list?.items[0].personName).toBeNull();
  });
});

describe("loadExpenseCommissions", () => {
  it("lista las del gasto con persona, venta, monto y estado, sin traer nada más del gasto", async () => {
    const a = commission({ expense_id: EXP_PAID, amount: 100 });
    const b = commission({ expense_id: EXP_PAID, user_id: ANA, role: "setter", amount: 50 });
    const elsewhere = commission({ expense_id: EXP_PROG });
    setup([a, b, elsewhere]);
    const list = await loadExpenseCommissions(ctxFor(), { id: EXP_PAID, origin: "commission_payout", source_ref: { commission_ids: [a.id, b.id] } });
    expect(list?.items.map((i) => [i.personName, i.contactName, i.amountCents, i.statusKey]).sort()).toEqual([
      ["Ana", "Lucía Pérez", 5000, "pagada"],
      ["Yo", "Lucía Pérez", 10000, "pagada"],
    ]);
    expect(list?.totalCents).toBe(15000);
    expect(JSON.stringify(list)).not.toMatch(/privado|Comisiones de Yo/);
  });

  it("un gasto anulado ya soltó sus comisiones: siguen listadas por source_ref y vuelven como pendientes", async () => {
    const released = commission({ expense_id: null, amount: 20 });
    setup([released]);
    const list = await loadExpenseCommissions(ctxFor(), { id: EXP_PAID, origin: "commission_payout", source_ref: { commission_ids: [released.id] } });
    expect(list?.items.map((i) => i.statusKey)).toEqual(["pendiente"]);
  });

  it("un gasto que no es de una liquidación no lista nada, y no se cuelan comisiones de otro workspace", async () => {
    const foreign = commission({ workspace_id: OTHER_WS, expense_id: EXP_PAID });
    setup([foreign]);
    expect(await loadExpenseCommissions(ctxFor(), { id: EXP_PAID, origin: "manual", source_ref: null })).toBeNull();
    const list = await loadExpenseCommissions(ctxFor(), { id: EXP_PAID, origin: "commission_payout", source_ref: { commission_ids: [foreign.id, "no-es-un-uuid"] } });
    expect(list?.items).toEqual([]);
  });
});

describe("loadDrawerExtras", () => {
  it("trae el estado de la venta y el lugar del pago entre sus cuotas", async () => {
    setup([]);
    expect(await loadDrawerExtras(ctxFor(), { saleId: SALE, paymentId: PAY2 })).toEqual({ saleStatus: "paid", installment: "Cuota 2 de 2", methodName: null });
    expect(await loadDrawerExtras(ctxFor(), { saleId: SALE, paymentId: PAY1 })).toMatchObject({ installment: "Cuota 1 de 2", methodName: "Whop (registrado a mano)" });
  });
  it("sin venta no hay nada que traer", async () => {
    expect(await loadDrawerExtras(ctxFor(), { saleId: null, paymentId: null })).toEqual({ saleStatus: null, installment: null, methodName: null });
  });
});
