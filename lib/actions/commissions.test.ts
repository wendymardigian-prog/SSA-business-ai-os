import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultCommissionRoles } from "@/lib/commissions/roles";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";
const C3 = "c3333333-3333-4333-8333-333333333333";
const SALE = "55555555-5555-4555-8555-555555555555";
const OTHER_SALE = "55555555-5555-4555-8555-555555555556";
const PAY = "66666666-6666-4666-8666-666666666661";
const PAY_OTHER_SALE = "66666666-6666-4666-8666-666666666662";
const REFUND = "66666666-6666-4666-8666-666666666663";
const EXP = "77777777-7777-4777-8777-777777777777";

let db: MemoryDb;
let allowed: Set<string>;
let auditFails = false;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit")>()),
  logAudit: vi.fn(async (a: Record<string, unknown>) => {
    if (auditFails) throw new Error("audit caído");
    audits.push(a);
    return "a";
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: ME, name: "Yo", role: "owner", email: "" },
    { userId: ANA, name: "Ana", role: "member", email: "" },
  ],
}));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    allowed.has(key) ? { supabase: db.client, user: { id: ME }, workspace: { id: WS, timezone: "UTC" } } : null,
}));

const actions = await import("./commissions");

const commission = (over: Record<string, unknown> = {}) => ({
  id: C1, workspace_id: WS, kind: "earned", role: "vendedor", user_id: ME, payment_id: PAY, sale_id: SALE, amount: 38.82, expense_id: null, voided_at: null, void_reason: null, ...over,
});

function payoutRpc(result: unknown) {
  return { create_commission_payout: () => result };
}

beforeEach(() => {
  audits.length = 0;
  auditFails = false;
  allowed = new Set(["commissions.manage", "expenses.manage"]);
  db = memoryDb({ commissions: [], expenses: [], sales: [], payments: [], workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() } }] });
});

describe("generar el gasto de una liquidación", () => {
  const input = (over: Record<string, unknown> = {}) => ({ ids: [C1, C2], mode: "per_person", scheduledDate: "2099-01-05", concepts: { [ME]: "Comisiones de Yo" }, notes: "  ", ...over });
  const rpcResult = {
    expenses: [{ id: EXP, user_id: ME, amount: 63.82, count: 2, commission_ids: [C1, C2] }],
    excluded: [{ id: C3, reason: "held" }, { id: "c4444444-4444-4444-8444-444444444444", reason: "not_found" }],
  };

  it("necesita LOS DOS permisos", async () => {
    allowed = new Set(["commissions.manage"]);
    expect(await actions.generateCommissionPayout(input())).toMatchObject({ ok: false, error: expect.stringContaining("comisiones y los gastos") });
    allowed = new Set(["expenses.manage"]);
    expect(await actions.generateCommissionPayout(input())).toMatchObject({ ok: false });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("llama a la RPC con el workspace y la persona de la SESIÓN, y devuelve gastos y excluidas con mensajes", async () => {
    db = memoryDb({ expenses: [{ id: EXP, workspace_id: WS, concept: "Comisiones de Yo", status: "programado", scheduled_date: "2099-01-05" }] }, { rpc: payoutRpc(rpcResult) });
    const r = await actions.generateCommissionPayout(input({ workspace_id: OTHER_WS, p_actor: ANA }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].name).toBe("create_commission_payout");
    expect(db.rpcCalls[0].args).toMatchObject({
      p_workspace: WS, p_commission_ids: [C1, C2], p_mode: "per_person", p_scheduled_date: "2099-01-05", p_concepts: { [ME]: "Comisiones de Yo" }, p_notes: null, p_actor: ME,
    });
    expect(String(db.rpcCalls[0].args.p_today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.expenses).toEqual([{ id: EXP, userId: ME, amountCents: 6382, count: 2, commissionIds: [C1, C2] }]);
    expect(r.excluded).toEqual([
      { id: C3, reason: "held", message: "Está retenida: todavía no se puede pagar" },
      { id: "c4444444-4444-4444-8444-444444444444", reason: "not_found", message: "No existe" },
    ]);
  });

  it("deja el historial: un `expense.created` por gasto y un `commission.payout_assigned` por comisión", async () => {
    db = memoryDb({ expenses: [{ id: EXP, workspace_id: WS, concept: "Comisiones de Yo", status: "programado", scheduled_date: "2099-01-05" }] }, { rpc: payoutRpc(rpcResult) });
    await actions.generateCommissionPayout(input());
    const expenseAudit = audits.find((a) => a.entityType === "expense")!;
    expect(expenseAudit).toMatchObject({
      entityId: EXP, action: "expense.created", performedBy: ME, workspaceId: WS,
      metadata: { origin: "commission_payout", commission_ids: [C1, C2], mode: "per_person", user_id: ME, count: 2 },
    });
    expect((expenseAudit.changes as Record<string, unknown>).amount).toEqual({ old: null, new: 63.82 });
    const perCommission = audits.filter((a) => a.entityType === "commission");
    expect(perCommission.map((a) => [a.entityId, a.action, a.changes])).toEqual([
      [C1, "commission.payout_assigned", { expense_id: { old: null, new: EXP } }],
      [C2, "commission.payout_assigned", { expense_id: { old: null, new: EXP } }],
    ]);
  });

  it("si el historial falla, el gasto ya está creado y el resultado sigue siendo ok", async () => {
    db = memoryDb({ expenses: [] }, { rpc: payoutRpc(rpcResult) });
    auditFails = true;
    expect((await actions.generateCommissionPayout(input())).ok).toBe(true);
  });

  it("valida lo que llega: ids, modo, fecha (y que no sea de hace más de 60 días), conceptos", async () => {
    expect((await actions.generateCommissionPayout(input({ ids: [] }))).ok).toBe(false);
    expect((await actions.generateCommissionPayout(input({ ids: ["no-uuid"] }))).ok).toBe(false);
    expect((await actions.generateCommissionPayout(input({ mode: "todos" }))).ok).toBe(false);
    expect((await actions.generateCommissionPayout(input({ scheduledDate: "mañana" }))).ok).toBe(false);
    expect(await actions.generateCommissionPayout(input({ scheduledDate: "2020-01-01" }))).toEqual({ ok: false, error: "La fecha programada no puede ser anterior a hace 60 días" });
    expect((await actions.generateCommissionPayout(input({ concepts: { "no-es-clave": "x" } }))).ok).toBe(false);
    expect((await actions.generateCommissionPayout(input({ concepts: { single: "x".repeat(201) } }))).ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("manda las notas recortadas, y los repetidos una sola vez", async () => {
    db = memoryDb({}, { rpc: payoutRpc({ expenses: [], excluded: [] }) });
    await actions.generateCommissionPayout(input({ ids: [C1, C1, C2], notes: "  Pago de octubre  ", mode: "single", concepts: { single: "Equipo" } }));
    expect(db.rpcCalls[0].args).toMatchObject({ p_commission_ids: [C1, C2], p_notes: "Pago de octubre", p_mode: "single", p_concepts: { single: "Equipo" } });
  });

  it("si la RPC falla, dice un mensaje claro (y no el error técnico)", async () => {
    db = memoryDb({}, { rpc: { create_commission_payout: () => { throw new Error("deadlock detected"); } } });
    const r = await actions.generateCommissionPayout(input());
    expect(r).toEqual({ ok: false, error: "No pude generar el gasto" });
  });
});

describe("asignar la persona", () => {
  beforeEach(() => {
    db = memoryDb({ commissions: [commission({ user_id: null })] });
  });

  it("le pone la persona a una «Sin persona» y deja el historial", async () => {
    expect(await actions.assignCommissionPerson(C1, ANA)).toEqual({ ok: true });
    expect(db.rows("commissions")[0].user_id).toBe(ANA);
    expect(audits[0]).toMatchObject({ entityType: "commission", entityId: C1, action: "commission.person_assigned", changes: { user_id: { old: null, new: ANA } }, performedBy: ME });
  });

  it("no pisa a una que ya tiene persona, ni toca una anulada o en un gasto", async () => {
    db.rows("commissions")[0].user_id = ME;
    expect(await actions.assignCommissionPerson(C1, ANA)).toEqual({ ok: false, error: "Esa comisión ya tiene persona" });
    db.rows("commissions")[0].user_id = null;
    db.rows("commissions")[0].voided_at = "2026-10-01T00:00:00Z";
    expect(await actions.assignCommissionPerson(C1, ANA)).toEqual({ ok: false, error: "Esa comisión está anulada" });
    db.rows("commissions")[0].voided_at = null;
    db.rows("commissions")[0].expense_id = EXP;
    expect(await actions.assignCommissionPerson(C1, ANA)).toEqual({ ok: false, error: "Esa comisión ya está en un gasto" });
    expect(db.rows("commissions")[0].user_id).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("la persona tiene que ser del equipo; la comisión, del workspace de la sesión", async () => {
    expect(await actions.assignCommissionPerson(C1, STRANGER)).toEqual({ ok: false, error: "Esa persona no es del equipo" });
    expect(await actions.assignCommissionPerson(C1, "no-uuid")).toEqual({ ok: false, error: "Elegí una persona" });
    db.rows("commissions")[0].workspace_id = OTHER_WS;
    expect(await actions.assignCommissionPerson(C1, ANA)).toEqual({ ok: false, error: "Esa comisión no existe" });
  });

  it("sin permiso, no hace nada", async () => {
    allowed = new Set(["commissions.view"]);
    expect(await actions.assignCommissionPerson(C1, ANA)).toMatchObject({ ok: false });
    expect(db.rows("commissions")[0].user_id).toBeNull();
  });
});

describe("anular", () => {
  beforeEach(() => {
    db = memoryDb({ commissions: [commission()] });
  });

  it("anula una pendiente con motivo: quién, cuándo y por qué; y lo deja en el historial", async () => {
    expect(await actions.voidCommission(C1, "  Cobro mal cargado  ")).toEqual({ ok: true });
    const row = db.rows("commissions")[0];
    expect(row).toMatchObject({ voided_by: ME, void_reason: "Cobro mal cargado" });
    expect(typeof row.voided_at).toBe("string");
    expect(audits[0]).toMatchObject({ action: "commission.voided", changes: { void_reason: { old: null, new: "Cobro mal cargado" } }, metadata: { role: "vendedor", amount_cents: 3882, payment_id: PAY, sale_id: SALE } });
  });

  it("también anula una «Sin persona»", async () => {
    db.rows("commissions")[0].user_id = null;
    expect((await actions.voidCommission(C1, "no corresponde")).ok).toBe(true);
  });

  it("el motivo es obligatorio y tiene tope", async () => {
    expect(await actions.voidCommission(C1, "   ")).toEqual({ ok: false, error: "Contá por qué la anulás" });
    expect(await actions.voidCommission(C1, "x".repeat(501))).toEqual({ ok: false, error: "El motivo puede tener hasta 500 caracteres" });
    expect(db.rows("commissions")[0].voided_at).toBeNull();
  });

  it("una en un gasto (programado o pagado) no se anula; una ya anulada tampoco", async () => {
    db.rows("commissions")[0].expense_id = EXP;
    expect(await actions.voidCommission(C1, "x")).toMatchObject({ ok: false, error: expect.stringContaining("anulá primero el gasto") });
    db.rows("commissions")[0].expense_id = null;
    db.rows("commissions")[0].voided_at = "2026-10-01T00:00:00Z";
    expect(await actions.voidCommission(C1, "x")).toEqual({ ok: false, error: "Esa comisión ya está anulada" });
    expect(audits).toHaveLength(0);
  });

  it("de otro workspace no existe", async () => {
    db.rows("commissions")[0].workspace_id = OTHER_WS;
    expect(await actions.voidCommission(C1, "x")).toEqual({ ok: false, error: "Esa comisión no existe" });
  });
});

describe("ajustes", () => {
  beforeEach(() => {
    db = memoryDb({
      commissions: [],
      sales: [{ id: SALE, workspace_id: WS }, { id: OTHER_SALE, workspace_id: OTHER_WS }],
      payments: [{ id: PAY, workspace_id: WS, sale_id: SALE }, { id: PAY_OTHER_SALE, workspace_id: WS, sale_id: "55555555-5555-4555-8555-555555555599" }],
      workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() } }],
    });
  });
  const adj = (over: Record<string, unknown> = {}) => ({ userId: ANA, amount: -19.41, notes: "Reembolso del 50 %", ...over });

  it("crea un ajuste que resta, sin regla, con la fecha de hoy y listo para liquidar", async () => {
    const r = await actions.createCommissionAdjustment(adj({ saleId: SALE, paymentId: PAY, role: "vendedor" }));
    expect(r.ok).toBe(true);
    const row = db.rows("commissions")[0];
    expect(row).toMatchObject({ workspace_id: WS, kind: "adjustment", role: "vendedor", user_id: ANA, payment_id: PAY, sale_id: SALE, rule_id: null, amount: -19.41, notes: "Reembolso del 50 %", created_by: ME });
    expect(row.paid_on).toBe(row.available_on);
    expect(String(row.paid_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(audits[0]).toMatchObject({ entityType: "commission", entityId: (r as { id: string }).id, action: "commission.adjustment_created", metadata: { sale_id: SALE, payment_id: PAY } });
  });

  it("con solo el pago, toma la venta del pago", async () => {
    await actions.createCommissionAdjustment(adj({ paymentId: PAY }));
    expect(db.rows("commissions")[0].sale_id).toBe(SALE);
  });

  it("valida con el esquema: monto distinto de cero, motivo, 2 decimales", async () => {
    expect(await actions.createCommissionAdjustment(adj({ amount: 0 }))).toMatchObject({ ok: false, error: "El monto no puede ser 0" });
    expect(await actions.createCommissionAdjustment(adj({ notes: "  " }))).toMatchObject({ ok: false });
    expect(await actions.createCommissionAdjustment(adj({ amount: 1.234 }))).toMatchObject({ ok: false });
    expect(db.rows("commissions")).toHaveLength(0);
  });

  it("la persona, la venta, el pago y el rol salen del workspace de la sesión", async () => {
    expect(await actions.createCommissionAdjustment(adj({ userId: STRANGER }))).toEqual({ ok: false, error: "Esa persona no es del equipo" });
    expect(await actions.createCommissionAdjustment(adj({ saleId: OTHER_SALE }))).toEqual({ ok: false, error: "Esa venta no existe" });
    expect(await actions.createCommissionAdjustment(adj({ paymentId: "66666666-6666-4666-8666-666666666699" }))).toEqual({ ok: false, error: "Ese pago no existe" });
    expect(await actions.createCommissionAdjustment(adj({ saleId: SALE, paymentId: PAY_OTHER_SALE }))).toEqual({ ok: false, error: "Ese pago no es de esa venta" });
    expect(await actions.createCommissionAdjustment(adj({ role: "inventado" }))).toEqual({ ok: false, error: "Ese rol no existe" });
    expect(db.rows("commissions")).toHaveLength(0);
  });

  it("sin permiso, no crea nada", async () => {
    allowed = new Set(["commissions.view"]);
    expect(await actions.createCommissionAdjustment(adj())).toMatchObject({ ok: false });
    expect(db.rows("commissions")).toHaveLength(0);
  });
});

describe("sugerir ajustes por un reembolso", () => {
  const seed = () =>
    memoryDb({
      payments: [
        { id: PAY, workspace_id: WS, sale_id: SALE, type: "installment", amount: 500, refund_of_payment_id: null },
        { id: REFUND, workspace_id: WS, sale_id: SALE, type: "refund", amount: -250, refund_of_payment_id: PAY },
        { id: PAY_OTHER_SALE, workspace_id: OTHER_WS, sale_id: OTHER_SALE, type: "refund", amount: -10, refund_of_payment_id: PAY },
      ],
      commissions: [
        commission({ id: C1, user_id: ME, role: "vendedor", amount: 38.82 }),
        commission({ id: C2, user_id: ANA, role: "setter", amount: 25 }),
        commission({ id: C3, user_id: null, role: "contenido", amount: 15 }),
        commission({ id: "c4444444-4444-4444-8444-444444444444", user_id: ME, role: "setter", amount: 5, voided_at: "2026-10-01T00:00:00Z" }),
        commission({ id: "c5555555-5555-4555-8555-555555555555", kind: "adjustment", user_id: ANA, payment_id: REFUND, amount: -5, role: null }),
      ],
    });

  it("por persona: lo proporcional a lo reembolsado, sin crear nada", async () => {
    db = seed();
    const before = JSON.stringify(db.tables);
    const r = await actions.suggestRefundAdjustments(REFUND);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ refundPaymentId: REFUND, originalPaymentId: PAY, saleId: SALE, refundedCents: 25000, paidCents: 50000 });
    expect(r.suggestions).toEqual([
      { userId: ME, userName: "Yo", commissions: [{ id: C1, role: "vendedor", amountCents: 3882 }], originalCents: 3882, suggestedCents: -1941, alreadyAdjustedCents: 0 },
      { userId: ANA, userName: "Ana", commissions: [{ id: C2, role: "setter", amountCents: 2500 }], originalCents: 2500, suggestedCents: -1250, alreadyAdjustedCents: -500 },
    ]);
    // La «Sin persona» y la anulada no aparecen, y no se escribió nada.
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(audits).toHaveLength(0);
  });

  it("solo para un reembolso del workspace", async () => {
    db = seed();
    expect(await actions.suggestRefundAdjustments(PAY)).toEqual({ ok: false, error: "Ese pago no es un reembolso" });
    expect(await actions.suggestRefundAdjustments(PAY_OTHER_SALE)).toEqual({ ok: false, error: "Ese pago no existe" });
    expect(await actions.suggestRefundAdjustments("no-uuid")).toEqual({ ok: false, error: "Ese pago no existe" });
    db.rows("payments")[1].refund_of_payment_id = null;
    expect(await actions.suggestRefundAdjustments(REFUND)).toMatchObject({ ok: false, error: expect.stringContaining("de qué pago salió") });
  });

  it("un reembolso mayor al cobrado se topa en el 100 %", async () => {
    db = seed();
    db.rows("payments")[1].amount = -900;
    const r = await actions.suggestRefundAdjustments(REFUND);
    expect(r.ok && r.suggestions[0].suggestedCents).toBe(-3882);
  });

  it("sin permiso, nada", async () => {
    db = seed();
    allowed = new Set(["commissions.view"]);
    expect(await actions.suggestRefundAdjustments(REFUND)).toMatchObject({ ok: false });
  });
});
