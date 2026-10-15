/**
 * Ventas F26: updateSale, cancelSale, cancelSubscription y rebuildPlan.
 */
import { paymentMethodsFixture } from "@/lib/sales/test-support/payment-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const SALE = U(30);

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit")>()),
  logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }),
}));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: ME },
    workspace: { id: WS, timezone: "America/Costa_Rica", payment_methods: paymentMethodsFixture(["wise"]), max_discount_percent: null },
    role, roleId, supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { data: { ok: true }, error: null }; },
  }),
}));

const { updateSale, cancelSale, cancelSubscription, rebuildPlan } = await import("./sales");

const seed = () =>
  memoryDb({
    contacts: [{ id: U(10), workspace_id: WS, deleted_at: null }],
    workspace_members: [{ workspace_id: WS, user_id: ME }],
    workspace_roles: [],
    sales: [{
      id: SALE, workspace_id: WS, contact_id: U(10), status: "pending_payment", financing_type: "installments",
      base_amount: 1000, discount_amount: 0, final_amount: 1000, discount_reason: null, product_snapshot: { price: 1000 },
      product_variant_id: U(22), setter_id: ME, vendedor_id: null, attribution: null, attribution_touch_id: null,
      attribution_type: "none", notes: null, service_starts_at: null, plan_unbalanced: false, updated_at: "2026-10-01T10:00:00Z",
    }],
    payments: [
      { id: U(40), workspace_id: WS, sale_id: SALE, type: "installment", status: "paid", amount: 400 },
      { id: U(41), workspace_id: WS, sale_id: SALE, type: "installment", status: "scheduled", amount: 600 },
    ],
    contact_touches: [],
    product_variants: [], products: [],
  });

beforeEach(() => { role = "admin"; roleId = null; rpcCalls.length = 0; audits.length = 0; db = seed(); });

describe("updateSale", () => {
  it("sin sales.manage no escribe nada", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["sales.view"], scopes: {} } });
    expect(await updateSale({ saleId: SALE, notes: "x" })).toMatchObject({ ok: false, code: "permission" });
    expect(db.rows("sales")[0].notes).toBeNull();
  });

  it("una venta cancelada solo admite notas", async () => {
    db.rows("sales")[0].status = "cancelled";
    expect(await updateSale({ saleId: SALE, discount: { type: "amount", value: 50 } })).toMatchObject({ ok: false, code: "locked" });
    expect(await updateSale({ saleId: SALE, notes: "nota" })).toEqual({ ok: true });
    expect(db.rows("sales")[0].notes).toBe("nota");
  });

  it("cambiar el precio con cobros exige confirmación y motivo, y no toca lo cobrado", async () => {
    const base = { saleId: SALE, discount: { type: "amount" as const, value: 100 } };
    expect(await updateSale(base)).toMatchObject({ ok: false, code: "confirm_required" });
    expect(await updateSale({ ...base, confirmRepricing: true })).toMatchObject({ ok: false, code: "reason_required" });
    expect(await updateSale({ ...base, confirmRepricing: true, repricingReason: "Acuerdo" })).toEqual({ ok: true });
    const s = db.rows("sales")[0];
    expect(s.final_amount).toBe(900);
    expect(s.plan_unbalanced).toBe(true);
    expect(db.rows("payments").map((p) => p.amount)).toEqual([400, 600]);
    expect(audits.some((a) => a.action === "sale.repriced")).toBe(true);
  });

  it("si la venta cambió mientras se editaba: conflicto y no pisa", async () => {
    const r = await updateSale({ saleId: SALE, notes: "x", expectedUpdatedAt: "2026-10-01T09:00:00Z" });
    expect(r).toMatchObject({ ok: false, code: "conflict" });
    expect(db.rows("sales")[0].notes).toBeNull();
  });
});

describe("cancelSale", () => {
  it("pide motivo y pasa por la RPC cancel_sale", async () => {
    expect(await cancelSale({ saleId: SALE, reason: " " })).toMatchObject({ ok: false, code: "reason_required" });
    const r = await cancelSale({ saleId: SALE, reason: "Se arrepintió" });
    expect(r).toMatchObject({ ok: true });
    expect(rpcCalls[0]).toMatchObject({ name: "cancel_sale", args: { p_sale_id: SALE, p_reason: "Se arrepintió", p_actor_id: ME } });
  });

  it("cancelar es definitivo: una cancelada no se cancela de nuevo", async () => {
    db.rows("sales")[0].status = "cancelled";
    expect(await cancelSale({ saleId: SALE, reason: "x" })).toMatchObject({ ok: false, code: "locked" });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("cancelSubscription", () => {
  it("solo para suscripciones activas", async () => {
    expect(await cancelSubscription({ saleId: SALE, reason: "x" })).toMatchObject({ ok: false, code: "invalid" });
    Object.assign(db.rows("sales")[0], { financing_type: "subscription", status: "subscription_active" });
    expect(await cancelSubscription({ saleId: SALE, reason: "Pidió la baja" })).toEqual({ ok: true });
    expect(db.rows("sales")[0]).toMatchObject({ status: "subscription_cancelled", subscription_cancel_reason: "Pidió la baja" });
  });
});

describe("rebuildPlan", () => {
  it("anula lo programado, conserva lo cobrado y exige que cuadre con lo que falta", async () => {
    const bad = await rebuildPlan({ saleId: SALE, payments: [{ amount: 500, date: "2026-11-01" }] });
    expect(bad).toMatchObject({ ok: false, code: "invalid" });
    const ok = await rebuildPlan({ saleId: SALE, payments: [{ amount: 300, date: "2026-11-01" }, { amount: 300, date: "2026-12-01" }] });
    expect(ok).toEqual({ ok: true });
    const rows = db.rows("payments");
    expect(rows.find((p) => p.id === U(40))!.status).toBe("paid");
    expect(rows.find((p) => p.id === U(41))!.status).toBe("cancelled");
    expect(rows.filter((p) => p.status === "scheduled")).toHaveLength(2);
    expect(db.rows("sales")[0].plan_unbalanced).toBe(false);
  });
});
