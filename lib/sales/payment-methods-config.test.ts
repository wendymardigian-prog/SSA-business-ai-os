import { describe, expect, it, vi } from "vitest";
import { activeMethodKeys, methodDefs, newMethodKey, parsePaymentMethods, starterPaymentMethods, validateMethodsUpdate, type PaymentMethodConfig } from "./payment-methods-config";

const m = (over: Partial<PaymentMethodConfig> = {}): PaymentMethodConfig => ({ key: "stripe", name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3, active: true, created_at: "2026-10-15T00:00:00.000Z", ...over });

describe("parsePaymentMethods", () => {
  it("lo que no es una lista devuelve los 5 de arranque, todos activos y sin comisión", () => {
    for (const bad of [null, undefined, {}, "x", 4]) {
      const out = parsePaymentMethods(bad);
      expect(out.map((x) => x.key)).toEqual(["whop", "transferencia_cr", "transferencia_usa", "wise", "binance"]);
      expect(out.every((x) => x.active && x.fee_percent === 0 && x.fee_fixed === 0)).toBe(true);
    }
  });

  it("descarta una entrada inválida sin lanzar y conserva las demás", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = parsePaymentMethods([m(), { key: "MAL KEY", name: "x" }, m({ key: "wise", name: "Wise" })]);
    expect(out.map((x) => x.key)).toEqual(["stripe", "wise"]);
  });

  it("rechaza porcentajes fuera de rango, con más de 3 decimales y fijos con más de 2", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parsePaymentMethods([m({ fee_percent: 100.5 }), m({ key: "a1", fee_percent: 1.2345 }), m({ key: "b1", fee_fixed: 0.001 }), m({ key: "c1", fee_percent: 2.125 })]).map((x) => x.key)).toEqual(["c1"]);
  });

  it("una clave repetida se queda con la primera", () => {
    const out = parsePaymentMethods([m(), m({ name: "Otro" })]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Stripe");
  });

  it("si no queda ninguna usable vuelve al catálogo de arranque (un negocio sin métodos no cobraría nada)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parsePaymentMethods([{ nada: true }])).toHaveLength(5);
  });
});

describe("derivados", () => {
  it("activeMethodKeys y methodDefs", () => {
    const list = [m(), m({ key: "wise", name: "Wise", active: false })];
    expect(activeMethodKeys(list)).toEqual(["stripe"]);
    expect(methodDefs(list)[0]).toEqual({ key: "stripe", name: "Stripe", feePercent: 2.9, feeFixed: 0.3 });
    expect(methodDefs(list)).toHaveLength(2);
  });
});

describe("newMethodKey", () => {
  it("slug sin tildes ni símbolos", () => {
    expect(newMethodKey("Pagos Móviles CR", [])).toBe("pagos_moviles_cr");
    expect(newMethodKey("  Stripe!! ", [])).toBe("stripe");
  });
  it("si existe, suma _2, _3…", () => {
    expect(newMethodKey("Stripe", ["stripe"])).toBe("stripe_2");
    expect(newMethodKey("Stripe", ["stripe", "stripe_2"])).toBe("stripe_3");
  });
  it("un nombre sin letras ni números igual da una clave válida", () => {
    expect(newMethodKey("???", [])).toMatch(/^[a-z0-9_]{2,40}$/);
    expect(newMethodKey("a", [])).toMatch(/^[a-z0-9_]{2,40}$/);
  });
});

describe("validateMethodsUpdate", () => {
  const before = starterPaymentMethods();
  it("acepta cambiar un porcentaje, agregar uno y desactivar otro", () => {
    const after = [...before.map((x) => (x.key === "wise" ? { ...x, fee_percent: 1 } : x.key === "binance" ? { ...x, active: false } : x)), m()];
    expect(validateMethodsUpdate(before, after)).toEqual({ ok: true });
  });
  it("no se puede quitar un método ni cambiar su key", () => {
    expect(validateMethodsUpdate(before, before.slice(1))).toMatchObject({ ok: false });
    expect(validateMethodsUpdate(before, before.map((x) => (x.key === "wise" ? { ...x, key: "wise2" } : x)))).toMatchObject({ ok: false });
  });
  it("dos nombres iguales, sin importar mayúsculas, se rechazan", () => {
    expect(validateMethodsUpdate(before, [...before, m({ name: "WISE" })])).toMatchObject({ ok: false });
  });
  it("tiene que quedar al menos un método activo", () => {
    expect(validateMethodsUpdate(before, before.map((x) => ({ ...x, active: false })))).toMatchObject({ ok: false });
  });
  it("dos entradas con la misma clave se rechazan", () => {
    expect(validateMethodsUpdate(before, [...before, m({ key: "wise", name: "Otro nombre" })])).toMatchObject({ ok: false });
  });
});
