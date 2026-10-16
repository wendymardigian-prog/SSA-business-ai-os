import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultFinanceSettings } from "./settings";
import { starterPaymentMethods } from "@/lib/sales/payment-methods-config";

const audits: Array<Record<string, unknown>> = [];
const notices: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditAsSystem: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }) }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async (a: Record<string, unknown>) => { notices.push(a); return true; }) }));

const { generateRecurringStep, autoExpensesStep } = await import("./daily-steps");

const WS = "ws-1";
let db: MemoryDb;
const ctxOf = (localDate: string, timeZone = "America/Costa_Rica") => ({ db: db.client as never, workspaceId: WS, localDate, timeZone, review: { pending: 0 } });

const template = (over: Record<string, unknown> = {}) => ({
  id: "t1", workspace_id: WS, concept: "Google Workspace", vendor_id: null, category_key: "software", amount_type: "fixed", amount: 36, charge_mode: "automatic",
  frequency: "monthly", weekly_day: null, weekly_interval: null, monthly_day: 5, yearly_month: null, yearly_day: null, start_date: "2026-09-01", end_date: null,
  lead_days: 0, is_active: true, generation_anchor: "2026-10-01", responsible_id: null, notes: null, ...over,
});

const expenseUnique = { expenses: (a: Record<string, unknown>, b: Record<string, unknown>) => !!a.recurring_expense_id && a.recurring_expense_id === b.recurring_expense_id && a.scheduled_date === b.scheduled_date };

beforeEach(() => {
  audits.length = 0;
  notices.length = 0;
});

describe("generateRecurringStep", () => {
  const seed = (templates: Array<Record<string, unknown>>) =>
    (db = memoryDb({ workspaces: [{ id: WS, finance_settings: defaultFinanceSettings() }], recurring_expenses: templates, expenses: [] }, { unique: expenseUnique }));

  it("una fija con débito automático nace PAGADA con la fecha programada (no antes)", async () => {
    seed([template()]);
    const before = await generateRecurringStep(ctxOf("2026-10-04"));
    expect(before.created).toBe(0);
    const out = await generateRecurringStep(ctxOf("2026-10-05"));
    expect(out.created).toBe(1);
    expect(db.rows("expenses")[0]).toMatchObject({ status: "pagado", paid_date: "2026-10-05", amount: 36, origin: "recurring", recurring_expense_id: "t1", workspace_id: WS });
    expect(audits[0]).toMatchObject({ entityType: "expense", action: "recurring.expense_generated", label: "Finanzas: trabajo diario" });
  });

  it("una variable a mano con anticipación nace «por revisar» sin monto y se cuenta para el aviso", async () => {
    seed([template({ id: "t2", concept: "Contadora", amount_type: "variable", amount: null, charge_mode: "manual", monthly_day: 10, lead_days: 7 })]);
    const ctx = ctxOf("2026-10-03");
    const out = await generateRecurringStep(ctx);
    expect(out).toMatchObject({ created: 1, review_pending: 1 });
    expect(db.rows("expenses")[0]).toMatchObject({ status: "por_revisar", amount: 0, scheduled_date: "2026-10-10" });
    expect(ctx.review.pending).toBe(1);
  });

  it("correr el día dos veces no duplica (el índice único manda), ni siquiera si el gasto está anulado", async () => {
    seed([template()]);
    await generateRecurringStep(ctxOf("2026-10-05"));
    expect((await generateRecurringStep(ctxOf("2026-10-05"))).created).toBe(0);
    Object.assign(db.rows("expenses")[0], { status: "anulado" });
    expect((await generateRecurringStep(ctxOf("2026-10-06"))).created).toBe(0);
    expect(db.rows("expenses")).toHaveLength(1);
  });

  it("una pausada no genera; una plantilla que falla no frena a las demás y el paso lanza al final", async () => {
    seed([template({ id: "pausada", is_active: false }), template({ id: "rota", frequency: "monthly", monthly_day: null }), template({ id: "ok", concept: "OK" })]);
    // La «rota» no tiene regla válida: no genera nada pero tampoco lanza (datesToGenerate devuelve []).
    await generateRecurringStep(ctxOf("2026-10-05"));
    expect(db.rows("expenses").map((e) => e.recurring_expense_id)).toEqual(["ok"]);
  });

  it("lo que ya existía antes de reactivar (anclaje) no se genera", async () => {
    seed([template({ generation_anchor: "2026-10-10" })]);
    expect((await generateRecurringStep(ctxOf("2026-10-12"))).created).toBe(0);
  });
});

describe("autoExpensesStep", () => {
  const paid = (fee: number, paid_at: string, method = "whop", type = "installment") => ({ workspace_id: WS, payment_method: method, type, status: "paid", provider_fee_amount: fee, paid_at });
  const calls = () => db.rpcCalls.filter((c) => c.name === "upsert_auto_expense");
  const seed = (finance: Record<string, unknown>, payments: Array<Record<string, unknown>> = [], extra: Record<string, Array<Record<string, unknown>>> = {}, upsertResult: Record<string, unknown> = { action: "none" }) =>
    (db = memoryDb(
      {
        workspaces: [{ id: WS, finance_settings: { ...defaultFinanceSettings(), ...finance }, payment_methods: starterPaymentMethods() }],
        payments, expenses: [], integration_configs: [], meta_ads_insights_daily: [], ...extra,
      },
      { rpc: { upsert_auto_expense: () => upsertResult } },
    ));

  it("suma las comisiones del mes (3,00 + 12,38 + 0,10 = 15,48) en céntimos y el pago de las 23:30 locales cuenta en OCTUBRE", async () => {
    seed(
      { processor_fees: { whop: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } },
      [paid(3, "2026-10-05T15:00:00Z"), paid(12.38, "2026-10-20T15:00:00Z"), paid(0.1, "2026-11-01T05:30:00Z"), paid(99, "2026-09-10T15:00:00Z"), paid(50, "2026-10-06T15:00:00Z", "wise"), paid(77, "2026-10-07T15:00:00Z", "whop", "refund")],
    );
    await autoExpensesStep(ctxOf("2026-11-10"));
    const october = calls().find((c) => c.args.p_month === "2026-10");
    expect(october?.args).toMatchObject({ p_auto_key: "processor_fee:whop:2026-10", p_total_cents: 1548, p_concept: "Comisión Whop · octubre 2026", p_origin: "processor_fee", p_category_key: "processor_fees", p_charge_mode: "automatic", p_today: "2026-11-10" });
    expect(calls().map((c) => c.args.p_month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(calls().find((c) => c.args.p_month === "2026-09")?.args.p_total_cents).toBe(9900);
  });

  it("un método sin comisión llama igual con total 0 (la función decide: no se crea un gasto en cero)", async () => {
    seed({ processor_fees: { wise: { enabled: true, vendor_id: null, category_key: null, charge_mode: "manual" } } });
    await autoExpensesStep(ctxOf("2026-10-10"));
    expect(calls().every((c) => c.args.p_total_cents === 0)).toBe(true);
  });

  it("anota en el historial y avisa cuando el pagado cambió su total (una por mes recalculado)", async () => {
    seed({ processor_fees: { whop: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } }, [paid(45.8, "2026-10-05T15:00:00Z")], {}, { action: "mark_drift", expense_id: "e1", drift_cents: -420 });
    await autoExpensesStep(ctxOf("2026-11-06"));
    expect(audits.some((a) => a.action === "expense.drift_detected")).toBe(true);
    expect(notices.filter((n) => n.type === "expense_auto_changed")).toHaveLength(3); // una por mes de la ventana en este simulacro
    expect(notices[0]).toMatchObject({ entityType: "expense", entityId: "e1" });
  });

  it("pauta de Meta: solo nivel cuenta; una cuenta en EUR o sin filas de nivel cuenta no crea nada y se anota", async () => {
    const metaCfg = (currency: string) => ({ workspace_id: WS, type: "meta", config: { ad_accounts: [{ ad_account_id: "act_1", name: "Cuenta de ejemplo", currency, timezone: "America/Costa_Rica", sync_enabled: true }] } });
    const rows = [
      { workspace_id: WS, ad_account_id: "act_1", level: "account", date: "2026-10-03", spend: 300.5 },
      { workspace_id: WS, ad_account_id: "act_1", level: "account", date: "2026-10-04", spend: 211.84 },
      { workspace_id: WS, ad_account_id: "act_1", level: "campaign", date: "2026-10-03", spend: 300.5 },
    ];
    seed({ meta_ads: { act_1: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } }, [], { integration_configs: [metaCfg("USD")], meta_ads_insights_daily: rows });
    await autoExpensesStep(ctxOf("2026-10-20"));
    const oct = calls().find((c) => c.args.p_month === "2026-10");
    expect(oct?.args).toMatchObject({ p_auto_key: "meta_ads:act_1:2026-10", p_total_cents: 51234, p_concept: "Pauta Meta (Cuenta de ejemplo) · octubre 2026", p_category_key: "ads_meta", p_origin: "meta_ads" });
    expect(calls()).toHaveLength(1); // septiembre y noviembre no tienen filas de nivel cuenta

    seed({ meta_ads: { act_1: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } }, [], { integration_configs: [metaCfg("EUR")], meta_ads_insights_daily: rows });
    const eur = await autoExpensesStep(ctxOf("2026-10-20"));
    expect(calls()).toHaveLength(0);
    expect(String(eur.notes)).toContain("no es USD");
  });

  it("cierra el automático de un mes que terminó hace 3 días (cobro automático) con paid_date = último día; el 2/11 todavía no", async () => {
    const open = { id: "e1", workspace_id: WS, status: "programado", origin: "processor_fee", amount: 15.48, scheduled_date: "2026-10-31", auto_key: "processor_fee:whop:2026-10", paid_date: null };
    const finance = { processor_fees: { whop: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } };
    seed(finance, [], { expenses: [{ ...open }] });
    const early = await autoExpensesStep(ctxOf("2026-11-02"));
    expect(early.closed).toBe(0);
    expect(db.rows("expenses")[0].status).toBe("programado");
    const late = await autoExpensesStep(ctxOf("2026-11-03"));
    expect(late.closed).toBe(1);
    expect(db.rows("expenses")[0]).toMatchObject({ status: "pagado", paid_date: "2026-10-31" });
    expect(audits.some((a) => a.action === "expense.auto_closed")).toBe(true);
  });

  it("con cobro a mano no cierra solo", async () => {
    seed({ processor_fees: { whop: { enabled: true, vendor_id: null, category_key: null, charge_mode: "manual" } } }, [], { expenses: [{ id: "e1", workspace_id: WS, status: "vencido", origin: "processor_fee", amount: 10, scheduled_date: "2026-10-31", auto_key: "processor_fee:whop:2026-10" }] });
    expect((await autoExpensesStep(ctxOf("2026-11-20"))).closed).toBe(0);
  });

  it("si un recálculo falla, los demás corren y el paso lanza al final", async () => {
    db = memoryDb(
      { workspaces: [{ id: WS, finance_settings: { ...defaultFinanceSettings(), processor_fees: { whop: { enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic" } } }, payment_methods: starterPaymentMethods() }], payments: [], expenses: [] },
      { rpc: { upsert_auto_expense: (args) => { if (args.p_month === "2026-10") throw new Error("boom"); return { action: "none" }; } } },
    );
    await expect(autoExpensesStep(ctxOf("2026-11-10"))).rejects.toThrow(/fallaron 1 recálculos/);
    expect(calls()).toHaveLength(3);
  });
});

