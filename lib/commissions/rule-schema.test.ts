import { describe, expect, it } from "vitest";
import { cleanConditions, commissionRuleInputSchema, commissionRuleRow } from "./rule-schema";

const CARLA = "a0000000-0000-4000-8000-000000000004";
const MENTORIA = "b0000000-0000-4000-8000-000000000001";
const sale = commissionRuleInputSchema({ payee: "sale_vendedor" });
const fixed = commissionRuleInputSchema({ payee: "fixed" });
const valid = { name: "Vendedor · en cuotas", role: "vendedor", calcType: "percent", rate: 12 } as const;

describe("alta de una regla", () => {
  it("una regla mínima es válida y toma los valores por defecto", () => {
    const r = sale.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({ conditions: {}, base: "gross", holdDays: 0, isActive: true, fixedAmount: null, beneficiaryUserId: null, validFrom: null, validUntil: null });
    }
  });
  it("nombre obligatorio y de hasta 120", () => {
    expect(sale.safeParse({ ...valid, name: "  " }).success).toBe(false);
    expect(sale.safeParse({ ...valid, name: "x".repeat(121) }).success).toBe(false);
    expect(sale.safeParse({ ...valid, name: "x".repeat(120) }).success).toBe(true);
  });
  it("rechaza campos que no existen", () => {
    expect(sale.safeParse({ ...valid, nada: 1 }).success).toBe(false);
  });
});

describe("porcentaje", () => {
  it("0 < tasa <= 100 con hasta 3 decimales", () => {
    for (const rate of [0.001, 2.125, 12, 100]) expect(sale.safeParse({ ...valid, rate }).success, String(rate)).toBe(true);
    for (const rate of [0, -1, 100.001, 101, 2.1255]) expect(sale.safeParse({ ...valid, rate }).success, String(rate)).toBe(false);
  });
  it("un porcentaje sin tasa se rechaza", () => {
    expect(sale.safeParse({ ...valid, rate: null }).success).toBe(false);
    expect(sale.safeParse({ name: "x", role: "vendedor", calcType: "percent" }).success).toBe(false);
  });
  it("guardar un porcentaje descarta el monto fijo que hubiera", () => {
    const r = sale.parse({ ...valid, fixedAmount: 50 });
    expect(r.fixedAmount).toBeNull();
    expect(r.rate).toBe(12);
  });
});

describe("monto fijo", () => {
  const fx = { name: "Contenido", role: "contenido", calcType: "fixed" } as const;
  it("monto > 0 con hasta 2 decimales", () => {
    expect(sale.safeParse({ ...fx, fixedAmount: 15 }).success).toBe(true);
    expect(sale.safeParse({ ...fx, fixedAmount: 0.01 }).success).toBe(true);
    for (const fixedAmount of [0, -5, 1.005]) expect(sale.safeParse({ ...fx, fixedAmount }).success, String(fixedAmount)).toBe(false);
    expect(sale.safeParse(fx).success).toBe(false);
  });
  it("guardar un fijo descarta la tasa que hubiera", () => {
    const r = sale.parse({ ...fx, fixedAmount: 15, rate: 10 });
    expect(r.rate).toBeNull();
    expect(r.fixedAmount).toBe(15);
  });
});

describe("retención y vigencia", () => {
  it("hold_days de 0 a 365, entero", () => {
    expect(sale.safeParse({ ...valid, holdDays: 0 }).success).toBe(true);
    expect(sale.safeParse({ ...valid, holdDays: 365 }).success).toBe(true);
    expect(sale.safeParse({ ...valid, holdDays: 366 }).success).toBe(false);
    expect(sale.safeParse({ ...valid, holdDays: -1 }).success).toBe(false);
    expect(sale.safeParse({ ...valid, holdDays: 1.5 }).success).toBe(false);
  });
  it("valid_until >= valid_from (el mismo día vale)", () => {
    expect(sale.safeParse({ ...valid, validFrom: "2026-11-01", validUntil: "2026-11-01" }).success).toBe(true);
    expect(sale.safeParse({ ...valid, validFrom: "2026-11-02", validUntil: "2026-11-01" }).success).toBe(false);
    expect(sale.safeParse({ ...valid, validFrom: "2026-11-02" }).success).toBe(true);
    expect(sale.safeParse({ ...valid, validUntil: "2026-11-02" }).success).toBe(true);
  });
  it("fechas inválidas se rechazan; vacías son «sin límite»", () => {
    expect(sale.safeParse({ ...valid, validFrom: "2026-02-31" }).success).toBe(false);
    expect(sale.safeParse({ ...valid, validFrom: "1/11" }).success).toBe(false);
    const r = sale.parse({ ...valid, validFrom: "", validUntil: "" });
    expect(r.validFrom).toBeNull();
    expect(r.validUntil).toBeNull();
  });
});

describe("persona de la regla", () => {
  it("en un rol de persona fija es obligatoria", () => {
    expect(fixed.safeParse(valid).success).toBe(false);
    expect(fixed.safeParse({ ...valid, beneficiaryUserId: null }).success).toBe(false);
    const bad = fixed.safeParse(valid);
    if (!bad.success) expect(bad.error.issues.some((i) => i.path[0] === "beneficiaryUserId")).toBe(true);
    expect(fixed.safeParse({ ...valid, beneficiaryUserId: CARLA }).success).toBe(true);
  });
  it("en los demás roles es opcional (pisa a la persona de la venta o de la pieza)", () => {
    expect(sale.safeParse(valid).success).toBe(true);
    expect(sale.safeParse({ ...valid, beneficiaryUserId: CARLA }).success).toBe(true);
    expect(sale.safeParse({ ...valid, beneficiaryUserId: "no-es-uuid" }).success).toBe(false);
  });
});

describe("condiciones", () => {
  it("acepta todas las dimensiones", () => {
    const r = sale.safeParse({
      ...valid,
      conditions: {
        product_ids: [MENTORIA], financing_types: ["installments"], payment_methods: ["whop"], payment_types: ["installment"], channels: ["organic"],
        platforms: ["Instagram"], meta_campaign_ids: ["120200000000001"], utm: { campaign: { op: "contains", values: ["webinar"] } },
        payment_number: { from: 1, to: 3 }, sale_amount: { min: 100, max: 5000 },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.conditions.platforms).toEqual(["instagram"]);
  });
  it("rechaza ids que no son uuid, canales raros y dimensiones que no existen", () => {
    expect(sale.safeParse({ ...valid, conditions: { product_ids: ["x"] } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { channels: ["email"] } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { color: ["rojo"] } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { utm: { campaign: { op: "like", values: ["a"] } } } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { utm: { otra: { op: "equals", values: ["a"] } } } }).success).toBe(false);
  });
  it("rangos al revés se rechazan", () => {
    expect(sale.safeParse({ ...valid, conditions: { payment_number: { from: 3, to: 1 } } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { sale_amount: { min: 10, max: 5 } } }).success).toBe(false);
    expect(sale.safeParse({ ...valid, conditions: { payment_number: { from: 0 } } }).success).toBe(false);
  });
  it("las dimensiones vacías no se guardan", () => {
    const r = sale.parse({
      ...valid,
      conditions: { product_ids: [], utm: { campaign: { op: "contains", values: [] } }, payment_number: { from: null, to: null }, sale_amount: { min: 10, max: null } },
    });
    expect(r.conditions).toEqual({ sale_amount: { min: 10 } });
  });
});

describe("cleanConditions / commissionRuleRow", () => {
  it("cleanConditions con null o vacío da {}", () => {
    expect(cleanConditions(null)).toEqual({});
    expect(cleanConditions({})).toEqual({});
  });
  it("commissionRuleRow usa los nombres de columna", () => {
    const row = commissionRuleRow(fixed.parse({ ...valid, beneficiaryUserId: CARLA, base: "net_of_fees", holdDays: 7 }));
    expect(row).toEqual({
      name: "Vendedor · en cuotas", role: "vendedor", conditions: {}, calc_type: "percent", rate: 12, fixed_amount: null, base: "net_of_fees",
      beneficiary_user_id: CARLA, hold_days: 7, valid_from: null, valid_until: null, is_active: true,
    });
  });
});
