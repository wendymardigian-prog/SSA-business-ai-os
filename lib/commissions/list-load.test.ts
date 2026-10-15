import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { emptyCommissionFilters, type CommissionFilters } from "./filters";
import { defaultCommissionRoles } from "./roles";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const SALE = "55555555-5555-4555-8555-555555555551";
const SALE2 = "55555555-5555-4555-8555-555555555552";
const VAR = "88888888-8888-4888-8888-888888888881";
const PROD = "98888888-8888-4888-8888-888888888881";
const CONTACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EXP_PAID = "77777777-7777-4777-8777-777777777771";
const EXP_PROG = "77777777-7777-4777-8777-777777777772";
const PAY = "66666666-6666-4666-8666-666666666661";
const RULE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

let db: MemoryDb;
let service: MemoryDb;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => service.client }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: ME, name: "Yo", role: "owner", email: "" },
    { userId: ANA, name: "Ana", role: "member", email: "" },
  ],
}));

const { loadCommissionList, loadCommissionDetail, loadRulesScreen, COMMISSIONS_LOAD_LIMIT } = await import("./list-load");

function ctxFor(opts: { scope?: "all" | "own"; keys?: string[]; user?: string } = {}) {
  const keys = new Set(opts.keys ?? ["commissions.view", "commissions.manage", "expenses.manage"]);
  return {
    supabase: db.client,
    user: { id: opts.user ?? ME },
    workspace: { id: WS, timezone: "UTC" },
    can: (key: string) => keys.has(key),
    scope: () => opts.scope ?? "all",
  } as unknown as Parameters<typeof loadCommissionList>[0];
}

const commission = (n: number, over: Record<string, unknown> = {}) => ({
  id: `c${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`, workspace_id: WS, kind: "earned", role: "vendedor", user_id: ME, payment_id: PAY, sale_id: SALE, rule_id: RULE,
  amount: 10, base_amount: 100, paid_on: "2026-10-10", available_on: "2026-10-10", expense_id: null, voided_at: null,
  created_at: `2026-10-10T10:00:${String(n % 60).padStart(2, "0")}Z`, rule_snapshot: { name: "Vendedor 8 %" }, attribution_snapshot: { channel: "organic", source: "instagram", content_title: "Reel", ad_name: null },
  notes: null, void_reason: null, ...over,
});

const filters = (patch: Partial<CommissionFilters> = {}): CommissionFilters => ({ ...emptyCommissionFilters(), ...patch });

function setup(commissions: Array<Record<string, unknown>>, extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const shared = {
    commissions,
    expenses: [
      // El gasto trae MÁS columnas que las 4 permitidas: no tienen que salir.
      { id: EXP_PAID, workspace_id: WS, status: "pagado", scheduled_date: "2026-10-12", paid_date: "2026-10-13", concept: "Comisiones de Yo", amount: 500, vendor_id: "v", notes: "privado", receipt_path: "x" },
      { id: EXP_PROG, workspace_id: WS, status: "programado", scheduled_date: "2026-10-20", paid_date: null, concept: "Otro", amount: 80, vendor_id: "v", notes: "privado", receipt_path: null },
    ],
    sales: [
      { id: SALE, workspace_id: WS, contact_id: CONTACT, product_variant_id: VAR },
      { id: SALE2, workspace_id: WS, contact_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", product_variant_id: null },
    ],
    product_variants: [{ id: VAR, workspace_id: WS, product_id: PROD, name: "Mensual" }],
    products: [{ id: PROD, workspace_id: WS, name: "Mentoría" }],
    contacts: [{ id: CONTACT, workspace_id: WS, display_name: "Pedro" }, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", workspace_id: WS, display_name: "Lucía" }],
    workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() }, payment_methods: null }],
    ...extra,
  };
  db = memoryDb(shared);
  service = db;
}

beforeEach(() => {
  // «Hoy» fijo: el estado de una comisión (retenida, pagada este mes) depende de la fecha.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  setup([]);
});
afterEach(() => vi.useRealTimers());

describe("loadCommissionList", () => {
  it("sin commissions.view no devuelve nada y lo marca", async () => {
    setup([commission(1)]);
    const r = await loadCommissionList(ctxFor({ keys: ["expenses.manage"] }), filters());
    expect(r).toMatchObject({ denied: true, rows: [], total: 0 });
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("de cada gasto sale SOLO { expense_id, status, scheduled_date, paid_date }", async () => {
    setup([commission(1, { expense_id: EXP_PAID }), commission(2, { expense_id: EXP_PROG }), commission(3)]);
    const selects: string[] = [];
    const original = service.client.from.bind(service.client);
    (service.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table as never) as unknown as { select: (...a: unknown[]) => unknown };
      if (table === "expenses") {
        const select = b.select.bind(b);
        b.select = (cols: unknown, ...rest: unknown[]) => { selects.push(String(cols)); return select(cols, ...rest); };
      }
      return b;
    };
    const r = await loadCommissionList(ctxFor(), filters());
    expect(selects).toEqual(["id, status, scheduled_date, paid_date"]);
    const withExpense = r.rows.filter((x) => x.expense);
    expect(withExpense).toHaveLength(2);
    for (const row of withExpense) expect(Object.keys(row.expense!).sort()).toEqual(["expense_id", "paid_date", "scheduled_date", "status"]);
    expect(JSON.stringify(r)).not.toMatch(/privado|Comisiones de Yo|receipt|vendor/);
  });

  it("calcula el estado de cada fila con su gasto y la fecha de hoy", async () => {
    setup([commission(1, { expense_id: EXP_PAID }), commission(2, { expense_id: EXP_PROG }), commission(3), commission(4, { user_id: null }), commission(5, { voided_at: "2026-10-11T00:00:00Z" }), commission(6, { available_on: "2999-01-01" })]);
    const r = await loadCommissionList(ctxFor(), filters());
    expect(Object.fromEntries(r.rows.map((x) => [x.id.slice(1, 8), x.status.key]))).toEqual({
      "0000001": "pagada", "0000002": "en_gasto", "0000003": "pendiente", "0000004": "sin_persona", "0000005": "anulada", "0000006": "retenida",
    });
    expect(r.totals.byStatus.pagada.count).toBe(1);
    expect(r.pills.pendientes.count).toBe(2);
  });

  it("los totales y la cuenta son de TODO el filtro, no de la página", async () => {
    setup(Array.from({ length: 120 }, (_, i) => commission(i + 1, { amount: 1.5 })));
    const r = await loadCommissionList(ctxFor(), filters({ page: 2 }));
    expect(r.rows).toHaveLength(50);
    expect(r).toMatchObject({ total: 120, page: 2, pages: 3, pageSize: 50, truncated: false });
    expect(r.totals.total).toEqual({ count: 120, cents: 120 * 150 });
  });

  it("filtra por persona, rol y mes del cobro", async () => {
    setup([commission(1), commission(2, { user_id: ANA }), commission(3, { role: "setter" }), commission(4, { paid_on: "2026-09-30" })]);
    expect((await loadCommissionList(ctxFor(), filters({ users: [ANA] }))).rows.map((x) => x.userName)).toEqual(["Ana"]);
    expect((await loadCommissionList(ctxFor(), filters({ roles: ["setter"] }))).total).toBe(1);
    expect((await loadCommissionList(ctxFor(), filters({ month: "2026-09" }))).total).toBe(1);
    expect((await loadCommissionList(ctxFor(), filters({ from: "2026-10-01", to: "2026-10-31" }))).total).toBe(3);
  });

  it("filtra por estado, por pastilla, por venta, por gasto y por regla", async () => {
    setup([commission(1, { expense_id: EXP_PAID }), commission(2), commission(3, { sale_id: SALE2, rule_id: null }), commission(4, { expense_id: EXP_PROG })]);
    expect((await loadCommissionList(ctxFor(), filters({ statuses: ["pagada"] }))).total).toBe(1);
    expect((await loadCommissionList(ctxFor(), filters({ pill: "pendientes" }))).total).toBe(2);
    expect((await loadCommissionList(ctxFor(), filters({ saleId: SALE2 }))).total).toBe(1);
    expect((await loadCommissionList(ctxFor(), filters({ expenseId: EXP_PROG }))).total).toBe(1);
    expect((await loadCommissionList(ctxFor(), filters({ ruleId: RULE }))).total).toBe(3);
  });

  it("las pastillas ignoran la pastilla y el estado elegidos (cada una cuenta lo suyo)", async () => {
    setup([commission(1, { expense_id: EXP_PAID }), commission(2), commission(3, { user_id: null })]);
    const r = await loadCommissionList(ctxFor(), filters({ pill: "sin_persona" }));
    expect(r.total).toBe(1);
    expect(r.pills.pendientes.count).toBe(1);
    expect(r.pills.pagadas_mes.count).toBe(1); // el gasto se pagó el 13/10 y «hoy» es el 15/10
    expect(r.pills.sin_persona.count).toBe(1);
  });

  it("filtra por contacto (a través de sus ventas) y por producto (a través de la variante)", async () => {
    setup([commission(1), commission(2, { sale_id: SALE2 }), commission(3, { sale_id: null })]);
    const byContact = await loadCommissionList(ctxFor(), filters({ contactId: CONTACT }));
    expect(byContact.rows.map((x) => x.contactName)).toEqual(["Pedro"]);
    const byProduct = await loadCommissionList(ctxFor(), filters({ products: [PROD] }));
    expect(byProduct.rows.map((x) => [x.productName, x.variantName])).toEqual([["Mentoría", "Mensual"]]);
    // un contacto sin ventas: lista vacía sin tocar las comisiones
    expect((await loadCommissionList(ctxFor(), filters({ contactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9" }))).rows).toEqual([]);
  });

  it("agrupa cuando se pide", async () => {
    setup([commission(1), commission(2, { user_id: ANA, amount: 30 }), commission(3, { voided_at: "2026-10-01T00:00:00Z" })]);
    const r = await loadCommissionList(ctxFor(), filters({ groupBy: "persona" }));
    expect(r.groups).toEqual([{ key: ANA, count: 1, cents: 3000 }, { key: ME, count: 1, cents: 1000 }]);
    expect((await loadCommissionList(ctxFor(), filters())).groups).toBeNull();
  });

  it("pinta contacto, producto, regla y atribución de la foto guardada; con el rol en palabras", async () => {
    setup([commission(1)]);
    const [row] = (await loadCommissionList(ctxFor(), filters())).rows;
    expect(row).toMatchObject({
      roleName: "Vendedor", userName: "Yo", contactName: "Pedro", productName: "Mentoría", variantName: "Mensual", ruleName: "Vendedor 8 %", amountCents: 1000, baseCents: 10000,
      attribution: { channel: "organic", source: "instagram", contentTitle: "Reel", adName: null }, notSelectable: null,
    });
  });

  it("marca por qué una fila no se puede seleccionar", async () => {
    setup([commission(1, { user_id: null }), commission(2, { expense_id: EXP_PROG }), commission(3, { available_on: "2999-01-01" }), commission(4)]);
    const r = await loadCommissionList(ctxFor(), filters());
    expect(Object.fromEntries(r.rows.map((x) => [x.id.slice(1, 8), x.notSelectable]))).toEqual({ "0000001": "no_person", "0000002": "already_in_expense", "0000003": "held", "0000004": null });
  });

  it("alcance `own`: aunque llegara una fila de otra persona, su nombre no sale; y no se ofrecen listas del equipo", async () => {
    setup([commission(1), commission(2, { user_id: ANA })]);
    const r = await loadCommissionList(ctxFor({ scope: "own", user: ME, keys: ["commissions.view"] }), filters());
    expect(r.scope).toBe("own");
    expect(r.rows.find((x) => x.id.startsWith("c0000002"))).toMatchObject({ userId: null, userName: null });
    expect(r.rows.find((x) => x.id.startsWith("c0000001"))).toMatchObject({ userId: ME, userName: "Yo" });
    expect(r.members).toEqual([]);
    expect(r.products).toEqual([]);
    expect(r).toMatchObject({ canManage: false, canPayout: false });
  });

  it("alcance `all`: ofrece las personas y los productos para los filtros", async () => {
    setup([commission(1)]);
    const r = await loadCommissionList(ctxFor(), filters());
    expect(r.scope).toBe("all");
    expect(r.members.map((m) => m.name)).toEqual(["Yo", "Ana"]);
    expect(r.products).toEqual([{ id: PROD, name: "Mentoría" }]);
    expect(r).toMatchObject({ canManage: true, canPayout: true });
    expect(r.roles.map((x) => x.key)).toEqual(["vendedor", "setter", "contenido", "pauta"]);
  });

  it("no lee comisiones de otro workspace, ni gastos o ventas de otro workspace", async () => {
    setup([commission(1, { workspace_id: OTHER_WS }), commission(2, { expense_id: EXP_PAID })], { expenses: [{ id: EXP_PAID, workspace_id: OTHER_WS, status: "pagado", scheduled_date: null, paid_date: "2026-10-13" }] });
    const r = await loadCommissionList(ctxFor(), filters());
    expect(r.total).toBe(1);
    // el gasto es de otro workspace: no se lee, y la comisión sigue «En gasto» sin fecha
    expect(r.rows[0]).toMatchObject({ expense: null });
    expect(r.rows[0].status.key).toBe("en_gasto");
  });

  it("lee de a 1.000 (PostgREST corta ahí) y, si pasa del tope, avisa que los totales miran las más nuevas", async () => {
    setup(Array.from({ length: COMMISSIONS_LOAD_LIMIT + 3 }, (_, i) => commission(i + 1)));
    const r = await loadCommissionList(ctxFor(), filters());
    expect(COMMISSIONS_LOAD_LIMIT).toBe(5000);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(COMMISSIONS_LOAD_LIMIT);
    expect(r.totals.total.count).toBe(COMMISSIONS_LOAD_LIMIT);
  });
});

describe("loadCommissionDetail", () => {
  const detailSeed = () =>
    setup(
      [commission(1, { expense_id: EXP_PAID, attribution_touch_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", currency: "USD", rule_snapshot: { name: "Vendedor 8 %", role: "vendedor", calc_type: "percent", rate: 8, fixed_amount: null, base: "gross", conditions: {}, position: 1 }, created_by: ME, voided_by: null })],
      {
        payments: [{ id: PAY, workspace_id: WS, type: "installment", status: "paid", paid_on: "2026-10-10", payment_method: "whop", amount: 500, provider_fee_amount: 14.8 }],
        contact_touches: [{ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", workspace_id: WS, channel: "organic", source: "instagram", medium: "dm", campaign: null, content_label: "c8k2f", term: null, origin: "dm", occurred_at: "2026-10-01T00:00:00Z" }],
        commission_rules: [{ id: RULE, workspace_id: WS, name: "Vendedor 12 %", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 12, fixed_amount: null, base: "gross", beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null }],
      },
    );
  const ID = "c0000001-0000-4000-8000-000000000000";

  it("junta la comisión, el pago, la venta, el contacto, el producto, la atribución y compara la regla usada con la actual", async () => {
    detailSeed();
    const d = await loadCommissionDetail(ctxFor(), ID);
    expect(d).toMatchObject({
      id: ID, roleName: "Vendedor", userName: "Yo", amountCents: 1000, status: { key: "pagada" }, expense: { expense_id: EXP_PAID, status: "pagado", paid_date: "2026-10-13" },
      sale: { id: SALE, contactName: "Pedro", productName: "Mentoría", variantName: "Mensual" },
      payment: { id: PAY, method: "whop", amountCents: 50000, feeCents: 1480 },
      attribution: { touch: { channel: "organic", source: "instagram", content: "c8k2f" } },
      scope: "all",
    });
    expect(d?.rule.used).toMatchObject({ name: "Vendedor 8 %", rate: 8 });
    expect(d?.rule.current).toMatchObject({ id: RULE, rate: 12 });
    expect(d?.rule.comparison).toMatchObject({ changed: true, fields: ["El nombre", "El porcentaje"] });
    expect(Object.keys(d!.expense!).sort()).toEqual(["expense_id", "paid_date", "scheduled_date", "status"]);
    expect(JSON.stringify(d)).not.toMatch(/privado|receipt|vendor/);
  });

  it("alcance `own`: sin los montos del pago ni la atribución completa del toque", async () => {
    detailSeed();
    const d = await loadCommissionDetail(ctxFor({ scope: "own", keys: ["commissions.view"] }), ID);
    expect(d?.payment).toMatchObject({ id: PAY, amountCents: null, feeCents: null });
    expect(d?.attribution.touch).toBeNull();
    expect(d?.attribution.snapshot).toMatchObject({ channel: "organic" });
    expect(d).toMatchObject({ canManage: false, scope: "own" });
  });

  it("una comisión que no existe, de otro workspace o sin permiso, es null", async () => {
    detailSeed();
    expect(await loadCommissionDetail(ctxFor(), "c9999999-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadCommissionDetail(ctxFor(), "no-uuid")).toBeNull();
    expect(await loadCommissionDetail(ctxFor({ keys: [] }), ID)).toBeNull();
    db.rows("commissions")[0].workspace_id = OTHER_WS;
    expect(await loadCommissionDetail(ctxFor(), ID)).toBeNull();
  });
});

describe("loadRulesScreen", () => {
  const rule = (n: number, over: Record<string, unknown> = {}) => ({
    id: `d${n}000000-0000-4000-8000-000000000000`, workspace_id: WS, name: `Regla ${n}`, role: "vendedor", position: n, conditions: {}, calc_type: "percent", rate: 8, fixed_amount: null, base: "gross",
    beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...over,
  });

  it("sin commissions.manage no devuelve nada", async () => {
    setup([]);
    expect(await loadRulesScreen(ctxFor({ keys: ["commissions.view"] }))).toBeNull();
  });

  it("reglas por rol con su frase, su estado y el aviso «nunca se usa»; más los valores UTM reales", async () => {
    setup([], {
      commission_rules: [rule(1), rule(2, { conditions: { product_ids: [PROD] } }), rule(3, { role: "setter", position: 1, is_active: false }), rule(4, { archived_at: "2026-01-01", position: 9 })],
      contact_touches: [
        { workspace_id: WS, occurred_at: "2999-01-01T00:00:00Z", source: "Instagram", medium: "cpc", campaign: "Black%20Friday", content_label: null, term: null },
        { workspace_id: WS, occurred_at: "2999-01-01T00:00:00Z", source: "instagram", medium: "dm", campaign: "black friday", content_label: "c8k2f", term: null },
        { workspace_id: OTHER_WS, occurred_at: "2999-01-01T00:00:00Z", source: "otra-cosa", medium: null, campaign: null, content_label: null, term: null },
        { workspace_id: WS, occurred_at: "2000-01-01T00:00:00Z", source: "viejo", medium: null, campaign: null, content_label: null, term: null },
      ],
    });
    const r = await loadRulesScreen(ctxFor());
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.loadError).toBe(false);
    expect(r.rules.vendedor.map((v) => [v.name, v.state, v.shadowed])).toEqual([["Regla 1", "activa", false], ["Regla 2", "activa", true]]);
    expect(r.rules.vendedor[1].description).toBe("Vendedor · Mentoría · 8 % del cobrado");
    expect(r.rules.setter.map((v) => v.state)).toEqual(["pausada"]);
    expect(r.rules.pauta).toEqual([]);
    expect(r.editor.utm.source).toEqual(["instagram"]);
    expect(r.editor.utm.campaign).toEqual(["black friday"]);
    expect(r.editor.products).toEqual([{ id: PROD, name: "Mentoría", status: undefined, archived: false }]);
    expect(r.editor.members.map((m) => m.name)).toEqual(["Yo", "Ana"]);
    expect(r.editor.methods.map((m) => m.key)).toContain("whop");
    expect(r.roles).toHaveLength(4);
  });
});
