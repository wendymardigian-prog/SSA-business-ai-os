import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const SALE = "55555555-5555-4555-8555-555555555551";
const SALE2 = "55555555-5555-4555-8555-555555555552";

let db: MemoryDb;
let allowed: Set<string>;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (allowed.has(key) ? { supabase: db.client, user: { id: ME }, workspace: { id: WS, timezone: "UTC" } } : null),
}));

const actions = await import("./commission-rules-lookup");

beforeEach(() => {
  allowed = new Set(["commissions.manage"]);
  db = memoryDb({
    contacts: [{ id: "c1", workspace_id: WS, display_name: "Pedro", email: null, deleted_at: null }, { id: "c2", workspace_id: WS, display_name: null, email: "lu@x.com", deleted_at: null }],
    sales: [
      { id: SALE, workspace_id: WS, contact_id: "c1", status: "paid", final_amount: 500, sale_date: "2026-10-10", created_at: "2026-10-10T10:00:00Z", product_snapshot: { product_name: "Mentoría", variant_name: "Mensual" } },
      { id: SALE2, workspace_id: WS, contact_id: "c2", status: "reserved", final_amount: 99.5, sale_date: "2026-10-12", created_at: "2026-10-12T10:00:00Z", product_snapshot: { product_name: "Curso" } },
      { id: "55555555-5555-4555-8555-555555555599", workspace_id: OTHER_WS, contact_id: "c9", status: "paid", final_amount: 1, sale_date: "2026-10-13", created_at: "2026-10-13T10:00:00Z", product_snapshot: {} },
    ],
    payments: [
      { id: "p1", workspace_id: WS, sale_id: SALE, type: "installment", status: "paid", amount: 250, paid_on: "2026-10-10", due_date: "2026-10-10", payment_method: "whop", created_at: "2026-10-10T10:00:00Z" },
      { id: "p2", workspace_id: WS, sale_id: SALE, type: "installment", status: "scheduled", amount: 250, paid_on: null, due_date: "2026-11-10", payment_method: null, created_at: "2026-10-10T10:00:01Z" },
      { id: "p3", workspace_id: WS, sale_id: SALE, type: "refund", status: "paid", amount: -50, paid_on: "2026-10-20", due_date: null, payment_method: null, created_at: "2026-10-20T10:00:00Z" },
      { id: "p4", workspace_id: WS, sale_id: SALE, type: "installment", status: "cancelled", amount: 10, paid_on: null, due_date: "2026-12-10", payment_method: null, created_at: "2026-10-10T10:00:02Z" },
    ],
    content_posts: [{ id: "post1", workspace_id: WS, title: "Reel de marzo", attribution_code: "c8k2f", deleted_at: null, updated_at: "2026-10-01" }, { id: "post2", workspace_id: OTHER_WS, title: "Ajeno", attribution_code: "zzz", deleted_at: null, updated_at: "2026-10-01" }],
    meta_campaigns: [{ workspace_id: WS, campaign_id: "111", name: "Black Friday", created_time: "2026-10-01" }, { workspace_id: OTHER_WS, campaign_id: "222", name: "Ajena", created_time: "2026-10-01" }],
    meta_ads: [{ workspace_id: WS, ad_id: "999", name: "Anuncio 1", campaign_id: "111", created_time: "2026-10-01" }],
  });
});

describe("searchSalesForCommissionTest", () => {
  it("sin texto, las más recientes del workspace, con el contacto y el producto", async () => {
    const result = await actions.searchSalesForCommissionTest("");
    expect(result.map((s) => s.id)).toEqual([SALE2, SALE]);
    expect(result[0]).toEqual({ id: SALE2, contactName: "lu@x.com", productText: "Curso", finalCents: 9950, status: "reserved", saleDate: "2026-10-12" });
    expect(result[1]).toMatchObject({ contactName: "Pedro", productText: "Mentoría · Mensual", finalCents: 50000 });
  });
  it("un texto de una letra no busca nada", async () => {
    expect(await actions.searchSalesForCommissionTest("p")).toEqual([]);
  });
  it("sin commissions.manage no devuelve nada", async () => {
    allowed = new Set(["commissions.view"]);
    expect(await actions.searchSalesForCommissionTest("")).toEqual([]);
  });
});

describe("loadSalePaymentsForCommissionTest", () => {
  it("devuelve los pagos de la venta sin reembolsos ni anulados, en orden de fecha", async () => {
    const result = await actions.loadSalePaymentsForCommissionTest(SALE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.payments[0]).toEqual({ id: "p1", type: "installment", status: "paid", amountCents: 25000, paidOn: "2026-10-10", dueDate: "2026-10-10", method: "whop" });
  });
  it("una venta de otro workspace, o un id inválido, no existe", async () => {
    expect(await actions.loadSalePaymentsForCommissionTest("55555555-5555-4555-8555-555555555599")).toMatchObject({ ok: false });
    expect(await actions.loadSalePaymentsForCommissionTest("no-uuid")).toMatchObject({ ok: false, error: "Esa venta no existe" });
  });
  it("sin permiso", async () => {
    allowed = new Set();
    expect(await actions.loadSalePaymentsForCommissionTest(SALE)).toMatchObject({ ok: false });
  });
});

describe("piezas y catálogo de Meta", () => {
  it("solo del workspace de la sesión", async () => {
    expect(await actions.searchPiecesForCommissionRule("reel")).toEqual([{ id: "post1", title: "Reel de marzo", code: "c8k2f" }]);
    expect(await actions.searchMetaForCommissionRule("campaign", "black")).toEqual([{ id: "111", name: "Black Friday", hint: null }]);
    expect(await actions.searchMetaForCommissionRule("ad", "anuncio")).toEqual([{ id: "999", name: "Anuncio 1", hint: "Black Friday" }]);
  });
  it("sin permiso o con una sola letra no devuelven nada", async () => {
    expect(await actions.searchPiecesForCommissionRule("r")).toEqual([]);
    allowed = new Set();
    expect(await actions.searchPiecesForCommissionRule("reel")).toEqual([]);
    expect(await actions.searchMetaForCommissionRule("ad", "anuncio")).toEqual([]);
  });
});
