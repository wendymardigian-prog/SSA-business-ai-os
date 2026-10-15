/**
 * Extra I, MP, F4: `updatePaymentMethods`. La base y los guards están en memoria; ningún servicio real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { paymentMethodsFixture } from "@/lib/sales/test-support/payment-methods";

const WS = "ws-1";
const ME = "00000000-0000-4000-8000-000000000001";

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }) }));
vi.mock("@/lib/sales/automation/templates-run", () => ({ ensureSalesTemplateFlows: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: ME }, workspace: { id: WS, timezone: "UTC" }, role, roleId, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t) }),
}));

const { updatePaymentMethods } = await import("./sales-settings");

const stored = () => db.rows("workspaces")[0].payment_methods as Array<Record<string, unknown>>;
const plain = (list: ReturnType<typeof paymentMethodsFixture>) => list.map((m) => ({ key: m.key, name: m.name, fee_percent: m.fee_percent, fee_fixed: m.fee_fixed, active: m.active }));

beforeEach(() => {
  role = "admin";
  roleId = null;
  audits.length = 0;
  db = memoryDb({ workspace_roles: [], workspaces: [{ id: WS, payment_methods: paymentMethodsFixture(["wise", "binance", "whop"]) }] });
});

describe("updatePaymentMethods", () => {
  it("un Member sin sales.settings no escribe nada", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["sales.view"], scopes: {} } });
    const before = JSON.stringify(stored());
    expect(await updatePaymentMethods(plain(paymentMethodsFixture(["wise"])))).toMatchObject({ ok: false });
    expect(JSON.stringify(stored())).toBe(before);
    expect(audits).toHaveLength(0);
  });

  it("agrega «Stripe» con 2,9 % + 0,30: recibe su clave del servidor y queda en la lista y en el historial", async () => {
    const current = plain(paymentMethodsFixture(["wise", "binance", "whop"]));
    const result = await updatePaymentMethods([...current, { name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3, active: true }]);
    expect(result).toMatchObject({ ok: true });
    const stripe = stored().find((m) => m.name === "Stripe");
    expect(stripe).toMatchObject({ key: "stripe", fee_percent: 2.9, fee_fixed: 0.3, active: true });
    expect(typeof stripe?.created_at).toBe("string");
    expect(audits[0]).toMatchObject({ entityType: "workspace", action: "payment_methods.updated", workspaceId: WS });
  });

  it("desactivar uno lo deja en la lista", async () => {
    const current = plain(paymentMethodsFixture(["wise", "binance", "whop"]));
    const result = await updatePaymentMethods(current.map((m) => (m.key === "wise" ? { ...m, active: false } : m)));
    expect(result).toMatchObject({ ok: true });
    expect(stored().find((m) => m.key === "wise")).toMatchObject({ active: false });
    expect(stored()).toHaveLength(5);
  });

  it("no se puede quitar un método, ni cambiar su clave, ni inventar una clave", async () => {
    const current = plain(paymentMethodsFixture(["wise", "binance", "whop"]));
    expect(await updatePaymentMethods(current.slice(1))).toMatchObject({ ok: false });
    expect(await updatePaymentMethods([...current, { key: "fantasma", name: "Fantasma", fee_percent: 0, fee_fixed: 0, active: true }])).toMatchObject({ ok: false });
    expect(stored()).toHaveLength(5);
  });

  it("rechaza un nombre repetido, ningún activo, y un porcentaje o un fijo inválidos", async () => {
    const current = plain(paymentMethodsFixture(["wise", "binance", "whop"]));
    expect(await updatePaymentMethods([...current, { name: "WISE", fee_percent: 0, fee_fixed: 0, active: true }])).toMatchObject({ ok: false });
    expect(await updatePaymentMethods(current.map((m) => ({ ...m, active: false })))).toMatchObject({ ok: false });
    expect(await updatePaymentMethods([...current, { name: "X1", fee_percent: 120, fee_fixed: 0, active: true }])).toMatchObject({ ok: false });
    expect(await updatePaymentMethods([...current, { name: "X2", fee_percent: 1, fee_fixed: 0.001, active: true }])).toMatchObject({ ok: false });
    expect(await updatePaymentMethods("no es una lista")).toMatchObject({ ok: false });
    expect(stored()).toHaveLength(5);
  });

  it("la clave de un método existente no cambia aunque se renombre", async () => {
    const current = plain(paymentMethodsFixture(["wise", "binance", "whop"]));
    await updatePaymentMethods(current.map((m) => (m.key === "wise" ? { ...m, name: "Wise Business" } : m)));
    expect(stored().find((m) => m.name === "Wise Business")?.key).toBe("wise");
  });
});
