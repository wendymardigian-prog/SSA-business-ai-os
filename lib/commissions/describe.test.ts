import { describe, expect, it } from "vitest";
import { describeConditions, describeRule, formatRate, isShadowed, moveByKeyboard, positionsFor, reorder, ruleState, type DescribeLookups } from "./describe";
import type { CommissionRule } from "./types";

const CARLA = "a0000000-0000-4000-8000-000000000004";
const ANA = "a0000000-0000-4000-8000-000000000001";
const JUAN = "a0000000-0000-4000-8000-000000000002";
const MENTORIA = "b0000000-0000-4000-8000-000000000001";
const CURSO = "b0000000-0000-4000-8000-000000000002";

const rule = (patch: Partial<CommissionRule> = {}): CommissionRule => ({
  id: "r", name: "r", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 10, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...patch,
});
const lookups: DescribeLookups = {
  roles: { vendedor: "Vendedor", marketing: "Marketing", contenido: "Contenido" },
  products: { [MENTORIA]: "Mentoría", [CURSO]: "Curso" },
  people: { [CARLA]: "Carla", [ANA]: "Ana", [JUAN]: "Juan" },
  methods: { whop: "Whop", stripe: "Stripe" },
};

describe("describeRule", () => {
  it("la frase con cuatro condiciones del plano", () => {
    const r = rule({
      conditions: { product_ids: [MENTORIA], financing_types: ["installments"], payment_methods: ["whop"] },
      rate: 12, base: "net_of_fees", valid_from: "2026-11-01",
    });
    expect(describeRule(r, lookups)).toBe("Vendedor · Mentoría · en cuotas · método Whop · 12 % del neto · desde el 1/11");
  });
  it("con UTM y una persona fija", () => {
    const r = rule({ role: "marketing", conditions: { utm: { campaign: { op: "contains", values: ["webinar"] } } }, rate: 2, beneficiary_user_id: CARLA });
    expect(describeRule(r, lookups)).toBe("Marketing · campaña contiene «webinar» · 2 % del cobrado · a Carla");
  });
  it("sin condiciones: solo rol y cálculo", () => {
    expect(describeRule(rule(), lookups)).toBe("Vendedor · 10 % del cobrado");
  });
  it("tasa con tres decimales y monto fijo", () => {
    expect(describeRule(rule({ rate: 2.125 }), lookups)).toBe("Vendedor · 2,125 % del cobrado");
    expect(describeRule(rule({ role: "contenido", calc_type: "fixed", rate: null, fixed_amount: 15 }), lookups)).toBe("Contenido · USD 15,00 fijos");
  });
  it("O dentro de una lista, retención y vigencia completa", () => {
    const r = rule({
      conditions: { product_ids: [MENTORIA, CURSO], payment_methods: ["whop", "stripe"], channels: ["organic"], platforms: ["instagram"] },
      hold_days: 7, valid_from: "2026-11-01", valid_until: "2026-11-30",
    });
    expect(describeRule(r, lookups)).toBe("Vendedor · Mentoría o Curso · métodos Whop o Stripe · canal orgánico · red Instagram · 10 % del cobrado · retiene 7 días · del 1/11 al 30/11");
  });
  it("un id que no se conoce se dice en genérico, nunca se muestra el uuid", () => {
    const text = describeRule(rule({ conditions: { product_ids: ["b0000000-0000-4000-8000-0000000000ff"] }, beneficiary_user_id: "a0000000-0000-4000-8000-0000000000ff" }), lookups);
    expect(text).toBe("Vendedor · otro producto · 10 % del cobrado · a una persona fija");
  });
  it("sin nombre de rol usa la clave", () => {
    expect(describeRule(rule({ role: "raro" }))).toBe("raro · 10 % del cobrado");
  });
});

describe("describeConditions", () => {
  it("cada dimensión en palabras", () => {
    const parts = describeConditions({
      user_ids: [ANA], vendedor_ids: [ANA], setter_ids: [JUAN], payment_types: ["installment"], payment_number: { from: 1, to: 1 },
      sale_amount: { min: 1000, max: 5000 }, meta_campaign_ids: ["1"], meta_ad_ids: ["2"], content_post_ids: ["x"],
      utm: { source: { op: "equals", values: ["instagram", "tiktok"] }, term: { op: "contains", values: ["curso"] } },
    }, lookups);
    expect(parts).toEqual([
      "persona Ana", "ventas de Ana", "setter Juan", "venta de USD 1.000,00 a USD 5.000,00", "cuota", "solo el pago 1",
      "pieza una pieza puntual", "campaña de Meta otra campaña", "anuncio de Meta otro anuncio", "fuente es «instagram» o «tiktok»", "término contiene «curso»",
    ]);
  });
  it("rangos de pago y de monto con un solo extremo", () => {
    expect(describeConditions({ payment_number: { from: 1, to: 3 } })).toEqual(["pagos del 1 al 3"]);
    expect(describeConditions({ payment_number: { from: 2 } })).toEqual(["desde el pago 2"]);
    expect(describeConditions({ payment_number: { to: 3 } })).toEqual(["hasta el pago 3"]);
    expect(describeConditions({ sale_amount: { min: 500 } })).toEqual(["venta desde USD 500,00"]);
    expect(describeConditions({ sale_amount: { max: 500 } })).toEqual(["venta hasta USD 500,00"]);
  });
  it("condiciones vacías o nulas no dicen nada", () => {
    expect(describeConditions(null)).toEqual([]);
    expect(describeConditions({ product_ids: [], utm: { campaign: { op: "contains", values: [] } } })).toEqual([]);
  });
});

describe("formatRate", () => {
  it("sin ceros de más y con coma", () => {
    expect(formatRate(12)).toBe("12");
    expect(formatRate(2.125)).toBe("2,125");
    expect(formatRate(0.5)).toBe("0,5");
  });
});

describe("ruleState", () => {
  it("activa, pausada, vencida, archivada", () => {
    expect(ruleState(rule(), "2026-10-15")).toBe("activa");
    expect(ruleState(rule({ is_active: false }), "2026-10-15")).toBe("pausada");
    expect(ruleState(rule({ valid_until: "2026-10-14" }), "2026-10-15")).toBe("vencida");
    expect(ruleState(rule({ valid_until: "2026-10-15" }), "2026-10-15")).toBe("activa");
    expect(ruleState(rule({ valid_from: "2026-12-01" }), "2026-10-15")).toBe("activa");
    expect(ruleState(rule({ archived_at: "2026-10-01T00:00:00Z" }), "2026-10-15")).toBe("archivada");
  });
});

describe("isShadowed", () => {
  const any = rule({ id: "any", conditions: {} });
  const mentoria = rule({ id: "m", conditions: { product_ids: [MENTORIA] } });
  it("«cualquier producto» arriba de «Mentoría»: nunca se usa", () => {
    expect(isShadowed(mentoria, [any])).toBe(true);
  });
  it("«Mentoría» arriba de «cualquier producto»: se usa", () => {
    expect(isShadowed(any, [mentoria])).toBe(false);
  });
  it("sin reglas arriba, nunca", () => {
    expect(isShadowed(any, [])).toBe(false);
  });
  it("una lista más amplia arriba cubre a una más angosta, no al revés", () => {
    const two = rule({ id: "two", conditions: { product_ids: [MENTORIA, CURSO] } });
    expect(isShadowed(mentoria, [two])).toBe(true);
    expect(isShadowed(two, [mentoria])).toBe(false);
  });
  it("una condición más en la de abajo la sigue dejando tapada; una más en la de arriba, no", () => {
    const strict = rule({ id: "s", conditions: { product_ids: [MENTORIA], payment_methods: ["whop"] } });
    expect(isShadowed(strict, [mentoria])).toBe(true);
    expect(isShadowed(mentoria, [strict])).toBe(false);
  });
  it("rangos: el de arriba tiene que contener al de abajo", () => {
    const from1 = rule({ id: "a", conditions: { payment_number: { from: 1 } } });
    const only1 = rule({ id: "b", conditions: { payment_number: { from: 1, to: 1 } } });
    const to3 = rule({ id: "c", conditions: { payment_number: { to: 3 } } });
    expect(isShadowed(only1, [from1])).toBe(true);
    expect(isShadowed(from1, [only1])).toBe(false);
    expect(isShadowed(from1, [to3])).toBe(false);
    const big = rule({ id: "d", conditions: { sale_amount: { min: 100 } } });
    const bigger = rule({ id: "e", conditions: { sale_amount: { min: 500, max: 900 } } });
    expect(isShadowed(bigger, [big])).toBe(true);
    expect(isShadowed(big, [bigger])).toBe(false);
  });
  it("vigencia: la de arriba sin fechas tapa a la de abajo con fechas, no al revés", () => {
    const dated = rule({ id: "dt", valid_from: "2026-11-01", valid_until: "2026-11-30" });
    expect(isShadowed(dated, [any])).toBe(true);
    expect(isShadowed(any, [dated])).toBe(false);
    const wider = rule({ id: "w", valid_from: "2026-10-01" });
    expect(isShadowed(dated, [wider])).toBe(true);
    expect(isShadowed(wider, [dated])).toBe(false);
  });
  it("UTM: «contiene» cubre a «es igual a» y a otro «contiene» más específico, no al revés", () => {
    const contains = rule({ id: "c", conditions: { utm: { campaign: { op: "contains", values: ["webinar"] } } } });
    const equals = rule({ id: "e", conditions: { utm: { campaign: { op: "equals", values: ["Webinar-Oct"] } } } });
    const narrower = rule({ id: "n", conditions: { utm: { campaign: { op: "contains", values: ["webinar-oct"] } } } });
    expect(isShadowed(equals, [contains])).toBe(true);
    expect(isShadowed(narrower, [contains])).toBe(true);
    expect(isShadowed(contains, [equals])).toBe(false);
    expect(isShadowed(contains, [narrower])).toBe(false);
    expect(isShadowed(equals, [rule({ id: "e2", conditions: { utm: { campaign: { op: "equals", values: ["webinar-oct", "bio"] } } } })])).toBe(true);
  });
  it("una regla de arriba pausada, archivada o de otro rol no tapa", () => {
    expect(isShadowed(mentoria, [{ ...any, is_active: false }])).toBe(false);
    expect(isShadowed(mentoria, [{ ...any, archived_at: "2026-10-01T00:00:00Z" }])).toBe(false);
    expect(isShadowed(mentoria, [{ ...any, role: "setter" }])).toBe(false);
  });
  it("una regla pausada o archivada no avisa", () => {
    expect(isShadowed({ ...mentoria, is_active: false }, [any])).toBe(false);
    expect(isShadowed({ ...mentoria, archived_at: "2026-10-01T00:00:00Z" }, [any])).toBe(false);
  });
});

describe("reorder", () => {
  const ids = ["a", "b", "c", "d"];
  it("mueve un elemento", () => {
    expect(reorder(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorder(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("no muta y tolera índices fuera de rango", () => {
    const copy = [...ids];
    reorder(ids, 0, 3);
    expect(ids).toEqual(copy);
    expect(reorder(ids, -1, 2)).toEqual(ids);
    expect(reorder(ids, 1, 9)).toEqual(ids);
    expect(reorder(ids, 2, 2)).toEqual(ids);
  });
  it("positionsFor numera 1..N", () => {
    expect(positionsFor(["x", "y"])).toEqual([{ id: "x", position: 1 }, { id: "y", position: 2 }]);
  });
});

describe("moveByKeyboard", () => {
  const ids = ["a", "b", "c"];
  it("las flechas solas mueven el foco, no la regla", () => {
    expect(moveByKeyboard(ids, 1, { key: "ArrowDown" })).toEqual({ ids, focusIndex: 2, moved: false });
    expect(moveByKeyboard(ids, 1, { key: "ArrowUp" })).toEqual({ ids, focusIndex: 0, moved: false });
  });
  it("Alt + flecha mueve la regla y el foco la sigue", () => {
    expect(moveByKeyboard(ids, 0, { key: "ArrowDown", altKey: true })).toEqual({ ids: ["b", "a", "c"], focusIndex: 1, moved: true });
    expect(moveByKeyboard(ids, 2, { key: "ArrowUp", altKey: true })).toEqual({ ids: ["a", "c", "b"], focusIndex: 1, moved: true });
  });
  it("en el borde no pasa nada", () => {
    expect(moveByKeyboard(ids, 0, { key: "ArrowUp", altKey: true })).toEqual({ ids, focusIndex: 0, moved: false });
    expect(moveByKeyboard(ids, 2, { key: "ArrowDown" })).toEqual({ ids, focusIndex: 2, moved: false });
  });
  it("otras teclas o un índice inválido devuelven null", () => {
    expect(moveByKeyboard(ids, 0, { key: "Enter" })).toBeNull();
    expect(moveByKeyboard(ids, 5, { key: "ArrowUp" })).toBeNull();
  });
});
