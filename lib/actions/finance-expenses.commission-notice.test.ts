/**
 * Al pagar un gasto de liquidación de comisiones, cada persona a la que se le debía recibe un aviso con lo suyo.
 * Nunca frena el pago y nunca le avisa a quien pagó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultFinanceSettings } from "@/lib/finance/settings";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const BETO = "44444444-4444-4444-8444-444444444444";
const EXP = "77777777-7777-4777-8777-777777777777";
const C = (n: number) => `c${n}000000-0000-4000-8000-00000000000${n}`;

let db: MemoryDb;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return "a"; }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: async () => [{ userId: ME }, { userId: ANA }, { userId: BETO }] }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async () => ({ supabase: db.client, user: { id: ME }, workspace: { id: WS, timezone: "UTC", finance_settings: defaultFinanceSettings() } }),
}));

const { markExpensePaid } = await import("./finance-expenses");

const expense = (over: Record<string, unknown> = {}) => ({
  id: EXP, workspace_id: WS, concept: "Comisiones del equipo", vendor_id: null, category_key: "commissions", amount: 100, status: "programado", scheduled_date: "2099-01-05", paid_date: null,
  origin: "commission_payout", responsible_id: null, notes: null, receipt_path: null, receipt_name: null, recurring_expense_id: null, adjusts_expense_id: null, updated_at: "2026-10-01T00:00:00Z", ...over,
});
const commission = (n: number, userId: string | null, amount: number, over: Record<string, unknown> = {}) => ({ id: C(n), workspace_id: WS, user_id: userId, amount, expense_id: EXP, voided_at: null, ...over });

const notices = () => db.rows("notifications");

beforeEach(() => {
  audits.length = 0;
  db = memoryDb({
    expenses: [expense()],
    commissions: [commission(1, ANA, 38.82), commission(2, ANA, 25), commission(3, BETO, 15), commission(4, ME, 10), commission(5, null, 7), commission(6, BETO, 99, { voided_at: "2026-10-01T00:00:00Z" })],
    notifications: [],
  });
});

describe("aviso al pagar un gasto de liquidación", () => {
  it("avisa a cada persona con el total de lo suyo, sin contar a quien pagó, a la «Sin persona» ni a las anuladas", async () => {
    expect((await markExpensePaid(EXP, { paidDate: "2026-10-15" })).ok).toBe(true);
    expect(db.rows("expenses")[0].status).toBe("pagado");
    const byUser = Object.fromEntries(notices().map((n) => [n.recipient_id, n]));
    expect(Object.keys(byUser).sort()).toEqual([ANA, BETO].sort());
    expect(byUser[ANA]).toMatchObject({ workspace_id: WS, type: "commission_payout_paid", title: "Se pagaron tus comisiones: USD 63,82", body: "El pago figura con fecha 2026-10-15.", entity_type: "commission", entity_id: null });
    expect(byUser[ANA].metadata).toEqual({ expense_id: EXP, count: 2 });
    // Una sola comisión: el aviso abre esa comisión.
    expect(byUser[BETO]).toMatchObject({ title: "Se pagaron tus comisiones: USD 15,00", entity_id: C(3) });
  });

  it("nunca le avisa a quien lo pagó", async () => {
    await markExpensePaid(EXP, { paidDate: "2026-10-15" });
    expect(notices().some((n) => n.recipient_id === ME)).toBe(false);
  });

  it("un gasto que NO es de liquidación no avisa a nadie (ni lee comisiones)", async () => {
    db.rows("expenses")[0].origin = "manual";
    expect((await markExpensePaid(EXP, { paidDate: "2026-10-15" })).ok).toBe(true);
    expect(notices()).toHaveLength(0);
  });

  it("no mira las comisiones de otro workspace", async () => {
    db.rows("commissions").forEach((c) => { c.workspace_id = OTHER_WS; });
    await markExpensePaid(EXP, { paidDate: "2026-10-15" });
    expect(notices()).toHaveLength(0);
  });

  it("si el aviso falla, el pago queda hecho igual", async () => {
    const original = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "commissions") throw new Error("base caída");
      return original(table as never);
    };
    const r = await markExpensePaid(EXP, { paidDate: "2026-10-15" });
    expect(r.ok).toBe(true);
    expect(db.rows("expenses")[0].status).toBe("pagado");
  });

  it("si el gasto ya estaba pagado (no se paga dos veces), no avisa de nuevo", async () => {
    await markExpensePaid(EXP, { paidDate: "2026-10-15" });
    const first = notices().length;
    expect((await markExpensePaid(EXP, { paidDate: "2026-10-16" })).ok).toBe(false);
    expect(notices()).toHaveLength(first);
  });
});
