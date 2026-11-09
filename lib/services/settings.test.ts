// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./service-settings.cases.json";
import { overdueRedDays, serviceMode, validateServiceSettings, withEnabledAt } from "./settings";

describe("validateServiceSettings (gemela de app_servicio.validate_service_settings)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(validateServiceSettings(c.settings)).toEqual(c.expected);
    });
  }

  const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const V_CREATE = "33333333-3333-4333-8333-333333333333";
  const V_NONE = "44444444-4444-4444-8444-444444444444";
  const V_OTHER = "55555555-5555-4555-8555-555555555555";
  const variants = [
    { id: V_CREATE, productId: P, mode: "create" as const },
    { id: V_NONE, productId: P, mode: "none" as const },
    { id: V_OTHER, productId: OTHER, mode: "create" as const },
  ];
  const extend = (fb: string, targets: string[] | null = null) => ({
    mode: "extend",
    when: { rule: "any_payment" },
    extend: { n: 3, unit: "months", target_variant_ids: targets, fallback_variant_id: fb },
  });

  it("con contexto: el respaldo de otro producto se rechaza", () => {
    expect(validateServiceSettings(extend(V_OTHER), { productId: P, variants })).toEqual(["la variante de respaldo tiene que ser de este producto"]);
  });
  it("con contexto: el respaldo que no crea servicio se rechaza", () => {
    expect(validateServiceSettings(extend(V_NONE), { productId: P, variants })).toEqual(["la variante de respaldo tiene que crear un servicio"]);
  });
  it("con contexto: una variante destino de otro producto se rechaza", () => {
    expect(validateServiceSettings(extend(V_CREATE, [V_OTHER]), { productId: P, variants })).toEqual(["las variantes a extender tienen que ser de este producto"]);
  });
  it("con contexto: una persona que no es del equipo se rechaza", () => {
    const s = { mode: "create", when: { rule: "any_payment" }, owner: { mode: "fixed", user_id: "11111111-1111-4111-8111-111111111111", fallback_user_id: "22222222-2222-4222-8222-222222222222" } };
    expect(validateServiceSettings(s, { members: ["22222222-2222-4222-8222-222222222222"] })).toEqual(["hay una persona que no es del equipo"]);
  });
});

describe("serviceMode, withEnabledAt y overdueRedDays", () => {
  it("{} es none", () => expect(serviceMode({})).toBe("none"));
  it("pasar de none a create fija enabled_at", () => {
    const out = withEnabledAt({}, { mode: "create", when: { rule: "any_payment" } }, "2026-11-07T15:00:00Z");
    expect(out.when?.enabled_at).toBe("2026-11-07T15:00:00Z");
  });
  it("seguir en create conserva el enabled_at anterior", () => {
    const prev = { mode: "create", when: { rule: "any_payment", enabled_at: "2026-01-01T00:00:00Z" } };
    const out = withEnabledAt(prev, { mode: "create", when: { rule: "percent", value: 50 } }, "2026-11-07T15:00:00Z");
    expect(out.when?.enabled_at).toBe("2026-01-01T00:00:00Z");
  });
  it("volver a none borra when", () => {
    const out = withEnabledAt({ mode: "create", when: { rule: "any_payment", enabled_at: "x" } }, { mode: "none" }, "now");
    expect(out.when).toBeUndefined();
  });
  it("rojo por pagos: 15 por defecto", () => {
    expect(overdueRedDays({})).toBe(15);
    expect(overdueRedDays({ light: { overdue_red_days: 20 } })).toBe(20);
  });
});
