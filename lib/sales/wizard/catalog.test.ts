import { describe, expect, it } from "vitest";
import { buildWizardCatalog } from "./catalog";

const product = (id: string, name: string, status = "active") => ({ id, name, product_type: "mentoria", status });
const variant = (id: string, product_id: string, over: Record<string, unknown> = {}) => ({
  id, product_id, name: `V-${id}`, duration_type: "lifetime", duration_value: null, billing_type: "one_time",
  billing_interval: null, display_order: 0, price: 0, archived_at: null, ...over,
});

describe("catálogo del asistente", () => {
  it("ofrece el precio de la variante y marca la variante sin precio (0)", () => {
    const out = buildWizardCatalog(
      [product("p1", "Mentoría")],
      [variant("v1", "p1", { price: "1297.00" }), variant("v2", "p1", { price: 0 })],
    );
    expect(out[0].variants[0]).toMatchObject({ price: 1297, unavailable: null, detail: "Pago único · De por vida" });
    expect(out[0].variants[1]).toMatchObject({ price: null });
    expect(out[0].variants[1].unavailable).toMatch(/Sin precio/);
  });

  it("no ofrece productos inactivos ni variantes archivadas", () => {
    const out = buildWizardCatalog(
      [product("p1", "A"), product("p2", "B", "inactive")],
      [variant("v1", "p1", { archived_at: "2026-10-01T00:00:00Z" }), variant("v2", "p2")],
    );
    expect(out).toEqual([]);
  });
});
