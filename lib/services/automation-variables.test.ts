import { describe, expect, it } from "vitest";
import { serviceFlowVariables, serviceVariables } from "./automation";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { linkIdsFromVariables } from "@/lib/forms/link-variables";

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const SALE_ID = "22222222-2222-4222-8222-222222222222";
const service = {
  id: SERVICE_ID,
  status: "active",
  product_snapshot: { product_name: "Academy", variant_name: "6 meses" },
  starts_on: "2026-11-17",
  ends_on: null,
  light: "green",
  phase_name: "Onboarding",
};

describe("serviceFlowVariables", () => {
  it("el flujo lee {{service.*}} (antes quedaban sin resolver: la clave era plana)", () => {
    const vars = serviceFlowVariables(service, SALE_ID);
    expect(interpolateVariables("{{service.variant}} · {{service.phase}}", vars)).toBe("6 meses · Onboarding");
  });

  it("el link firmado recibe el servicio Y la venta (de ahi salen venta.variante y venta.monto del contrato)", () => {
    expect(linkIdsFromVariables(serviceFlowVariables(service, SALE_ID))).toEqual({ serviceId: SERVICE_ID, saleId: SALE_ID });
  });

  it("sin venta en el servicio, no inventa `sale`", () => {
    const vars = serviceFlowVariables(service, null);
    expect(vars).not.toHaveProperty("sale");
    expect(linkIdsFromVariables(vars)).toEqual({ serviceId: SERVICE_ID, saleId: null });
  });

  it("conserva las claves planas de siempre", () => {
    const vars = serviceFlowVariables(service, SALE_ID);
    for (const [key, value] of Object.entries(serviceVariables(service))) expect(vars[key]).toBe(value);
  });

  it("sin servicio no devuelve nada", () => {
    expect(serviceFlowVariables(null, SALE_ID)).toEqual({});
  });
});
