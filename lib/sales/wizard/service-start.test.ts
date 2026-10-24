import { describe, expect, it } from "vitest";
import { defaultServiceStart, resolveServiceStart, serviceStartHint } from "./service-start";

describe("inicio del servicio según el tipo", () => {
  it("con duración arranca el día de la compra", () => {
    expect(defaultServiceStart("duration", null, "2026-10-24")).toBe("2026-10-24");
  });
  it("un evento arranca en su fecha fija (sin fecha cargada, la de la compra)", () => {
    expect(defaultServiceStart("event", "2026-11-15", "2026-10-24")).toBe("2026-11-15");
    expect(defaultServiceStart("event", null, "2026-10-24")).toBe("2026-10-24");
  });
  it("un producto no tiene inicio, aunque se haya escrito uno", () => {
    expect(defaultServiceStart("none", null, "2026-10-24")).toBeNull();
    expect(resolveServiceStart("2026-12-01", "none", null, "2026-10-24")).toBeNull();
  });
  it("lo escrito a mano gana", () => {
    expect(resolveServiceStart("2026-12-01", "duration", null, "2026-10-24")).toBe("2026-12-01");
    expect(resolveServiceStart("", "event", "2026-11-15", "2026-10-24")).toBe("2026-11-15");
  });
  it("la ayuda dice de dónde sale", () => {
    expect(serviceStartHint("event")).toMatch(/evento/);
    expect(serviceStartHint("duration")).toMatch(/venta/);
  });
});
