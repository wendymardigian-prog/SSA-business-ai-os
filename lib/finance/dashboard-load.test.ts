import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultFinanceSettings } from "./settings";
import { loadFinanceDashboard } from "./dashboard-load";

const WS = "ws-1";
let db: MemoryDb;
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const ctxOf = () => ({ supabase: db.client, workspace: { id: WS, timezone: "America/Costa_Rica", finance_settings: defaultFinanceSettings() }, can: () => true }) as never;
// 10 de octubre de 2026, mediodía en Costa Rica.
const NOW = new Date("2026-10-10T18:00:00Z");

const pay = (amount: number, paid_at: string, type = "installment", status = "paid") => ({ workspace_id: WS, type, status, amount, paid_at });
const exp = (amount: number, paid_date: string, category_key = "software", vendor_id: string | null = null, status = "pagado") => ({ workspace_id: WS, status, amount, paid_date, category_key, vendor_id, scheduled_date: paid_date });

beforeEach(() => {
  db = memoryDb({
    payments: [
      pay(416.67, "2026-10-02T15:00:00Z"), pay(416.67, "2026-10-03T15:00:00Z"), pay(416.66, "2026-10-04T15:00:00Z"),
      pay(1000, "2026-09-30T23:30:00-06:00"), // 30/9 23:30 hora local: es de septiembre
      pay(-200, "2026-10-05T15:00:00Z", "refund"),
      pay(99, "2026-10-06T15:00:00Z", "installment", "scheduled"),
    ],
    expenses: [
      exp(500, "2026-10-03", "ads_meta", "v1"), exp(100, "2026-10-04", "software", "v2"), exp(50, "2026-10-05", "other", null),
      exp(300, "2026-09-10", "software", "v2"),
      { workspace_id: WS, status: "vencido", amount: 40, scheduled_date: "2026-10-01", category_key: "software" },
      { workspace_id: WS, status: "programado", amount: 60, scheduled_date: "2026-10-20", category_key: "software" },
      { workspace_id: WS, status: "programado", amount: 70, scheduled_date: "2026-12-20", category_key: "software" },
      { workspace_id: WS, status: "por_revisar", amount: 0, scheduled_date: "2026-10-15", category_key: "software" },
    ],
    sales: [{ workspace_id: WS, status: "paid", sale_date: "2026-10-02" }, { workspace_id: WS, status: "cancelled", sale_date: "2026-10-03" }, { workspace_id: WS, status: "paid", sale_date: "2026-09-01" }],
    vendors: [{ id: "v1", workspace_id: WS, name: "Meta", archived_at: null }, { id: "v2", workspace_id: WS, name: "Google", archived_at: null }],
  });
});

describe("loadFinanceDashboard", () => {
  it("este mes en Costa Rica: ingresos netos, gastos y resultado exactos en céntimos", async () => {
    const data = await loadFinanceDashboard(ctxOf(), {}, NOW);
    expect(data.loadError).toBe(false);
    expect(data.cards.map((c) => c.value)).toEqual(["USD 1.050,00", "USD 650,00", "USD 400,00", "38,1 %"]);
    expect(data.hasRevenue).toBe(true);
    expect(data.expensesCents).toBe(65000);
  });

  it("un pago del 30/9 a las 23:30 locales NO cuenta en octubre, y los programados no son ingresos", async () => {
    const data = await loadFinanceDashboard(ctxOf(), {}, NOW);
    expect(data.cards[0].detail).toContain("bruto USD 1.250,00");
    // Septiembre sí lo tiene en la tendencia.
    expect(data.trend.find((m) => m.month === "2026-09")?.revenueCents).toBe(100000);
    expect(data.trend).toHaveLength(6);
    expect(data.trend.find((m) => m.month === "2026-05")).toMatchObject({ revenueCents: 0, expensesCents: 0 });
  });

  it("agrupa por categoría y proveedor con links a la lista filtrada, y calcula el CAC con las ventas no canceladas", async () => {
    const data = await loadFinanceDashboard(ctxOf(), {}, NOW);
    expect(data.categories[0]).toMatchObject({ categoryKey: "ads_meta", cents: 50000 });
    expect(data.categories[0].href).toContain("pagado");
    expect(data.vendors.top.map((v) => v.name)).toEqual(["Meta", "Google"]);
    expect(data.vendors.withoutVendor).toMatchObject({ count: 1, cents: 5000 });
    expect(data.cac.cents).toBe(50000); // 500 de Adquisición (ads_meta) ÷ 1 venta nueva
  });

  it("por pagar: vencido, programado a 30 días y por revisar; el de diciembre no entra", async () => {
    const data = await loadFinanceDashboard(ctxOf(), {}, NOW);
    expect(data.upcoming.map((r) => r.kind)).toEqual(["overdue", "week", "review"]);
    expect(data.upcoming[0].amountText).toBe("USD 40,00");
  });

  it("la respuesta NO lleva filas de pagos ni de ventas, solo agregados", async () => {
    const data = await loadFinanceDashboard(ctxOf(), {}, NOW);
    const text = JSON.stringify(data);
    expect(text).not.toContain("paid_at");
    expect(text).not.toContain("sale_date");
    expect(text).not.toContain("installment");
  });

  it("Histórico no compara con un período anterior", async () => {
    const data = await loadFinanceDashboard(ctxOf(), { range: "historico" }, NOW);
    expect(data.cards.every((c) => c.variation.kind === "none")).toBe(true);
  });
});
