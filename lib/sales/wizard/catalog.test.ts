import { describe, expect, it } from "vitest";
import { buildWizardCatalog } from "./catalog";

const product = (id: string, name: string, status = "active") => ({ id, name, product_type: "mentoria", status });
const variant = (id: string, product_id: string, over: Record<string, unknown> = {}) => ({
  id, product_id, name: `V-${id}`, duration_type: "lifetime", duration_value: null, billing_type: "one_time",
  billing_interval: null, display_order: 0, archived_at: null, ...over,
});

describe("catálogo del asistente", () => {
  it("ofrece el precio de la versión activa y marca la variante sin versión vigente", () => {
    const out = buildWizardCatalog(
      [product("p1", "Mentoría")],
      [variant("v1", "p1"), variant("v2", "p1")],
      [
        { id: "ver1", product_variant_id: "v1", price: 1297, status: "active" },
        { id: "ver0", product_variant_id: "v1", price: 1000, status: "deprecated" },
        { id: "ver2", product_variant_id: "v2", price: 500, status: "draft" },
      ],
    );
    expect(out[0].variants[0]).toMatchObject({ versionId: "ver1", price: 1297, unavailable: null, detail: "Pago único · De por vida" });
    expect(out[0].variants[1]).toMatchObject({ versionId: null, price: null });
    expect(out[0].variants[1].unavailable).toMatch(/Sin precio vigente/);
  });

  it("no ofrece productos inactivos ni variantes archivadas", () => {
    const out = buildWizardCatalog(
      [product("p1", "A"), product("p2", "B", "inactive")],
      [variant("v1", "p1", { archived_at: "2026-10-01T00:00:00Z" }), variant("v2", "p2")],
      [],
    );
    expect(out).toEqual([]);
  });
});
