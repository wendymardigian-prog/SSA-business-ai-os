import { describe, expect, it } from "vitest";
import { resolveVariablePath } from "@/lib/flow-engine/interpolate";
import { linkIdsFromVariables } from "@/lib/forms/link-variables";
import { nestServiceVariables, serviceVariables } from "./automation";

const SERVICE = "11111111-1111-4111-8111-111111111111";
const SALE = "22222222-2222-4222-8222-222222222222";

const flat = serviceVariables({
  id: SERVICE,
  status: "active",
  product_snapshot: { product_name: "Scaling Systems Academy", variant_name: "SSA (3 meses)" },
  starts_on: "2026-11-13",
  ends_on: "2027-02-13",
  light: "green",
  phase_name: "Onboarding",
});

describe("nestServiceVariables", () => {
  it("deja {{service.*}} legible para el motor", () => {
    const vars = nestServiceVariables(flat, SALE);
    expect(resolveVariablePath(vars, "service.product")).toBe("Scaling Systems Academy");
    expect(resolveVariablePath(vars, "service.variant")).toBe("SSA (3 meses)");
    expect(resolveVariablePath(vars, "service.phase")).toBe("Onboarding");
  });

  it("el link firmado lleva el servicio y la venta", () => {
    expect(linkIdsFromVariables(nestServiceVariables(flat, SALE))).toEqual({ serviceId: SERVICE, saleId: SALE });
  });

  it("sin venta no inventa una", () => {
    const vars = nestServiceVariables(flat, null);
    expect(vars.sale).toBeUndefined();
    expect(linkIdsFromVariables(vars)).toEqual({ serviceId: SERVICE, saleId: null });
  });

  it("sin servicio no devuelve nada", () => {
    expect(nestServiceVariables({}, null)).toEqual({});
  });
});
