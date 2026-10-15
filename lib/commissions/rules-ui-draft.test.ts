import { describe, expect, it } from "vitest";
import {
  addTokens,
  describeDraft,
  draftFromRule,
  draftToInput,
  emptyRuleDraft,
  isDraftDirty,
  parseDecimal,
  parseWhole,
  previewRuleFrom,
  usdTextToCents,
  validateRuleDraft,
} from "./rules-ui-draft";
import { defaultCommissionRoles } from "./roles";
import type { CommissionRule } from "./types";

const roles = Object.fromEntries(defaultCommissionRoles().map((r) => [r.key, r]));
const ANA = "33333333-3333-4333-8333-333333333333";
const PROD = "98888888-8888-4888-8888-888888888881";

const rule = (over: Partial<CommissionRule> = {}): CommissionRule => ({
  id: "d1000000-0000-4000-8000-000000000000", name: "Vendedor 12 %", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 12,
  fixed_amount: null, base: "net_of_fees", beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...over,
});

describe("parseDecimal", () => {
  it("acepta coma o punto como decimal", () => {
    expect(parseDecimal("12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parseDecimal("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseDecimal(" 8 ")).toEqual({ ok: true, value: 8 });
    expect(parseDecimal("2,125")).toEqual({ ok: true, value: 2.125 });
  });
  it("con las dos, el último separador es el decimal", () => {
    expect(parseDecimal("1.250,75")).toEqual({ ok: true, value: 1250.75 });
    expect(parseDecimal("1,250.75")).toEqual({ ok: true, value: 1250.75 });
  });
  it("vacío es «sin valor»; lo que no es un número, no", () => {
    expect(parseDecimal("")).toEqual({ ok: true, value: null });
    expect(parseDecimal("doce")).toEqual({ ok: false });
    expect(parseDecimal("1,2,3")).toEqual({ ok: false });
    expect(parseDecimal("-5")).toEqual({ ok: false });
  });
  it("parseWhole rechaza los decimales", () => {
    expect(parseWhole("30")).toEqual({ ok: true, value: 30 });
    expect(parseWhole("2,5")).toEqual({ ok: false });
    expect(parseWhole("")).toEqual({ ok: true, value: null });
  });
  it("usdTextToCents", () => {
    expect(usdTextToCents("250")).toBe(25000);
    expect(usdTextToCents("19,99")).toBe(1999);
    expect(usdTextToCents("")).toBeNull();
    expect(usdTextToCents("x")).toBeNull();
  });
});

describe("emptyRuleDraft", () => {
  it("la primera regla de un rol de pieza se propone orgánica; la de Pauta, pautada", () => {
    expect(emptyRuleDraft(roles.contenido, 0).channels).toEqual(["organic"]);
    expect(emptyRuleDraft(roles.pauta, 0).channels).toEqual(["paid"]);
  });
  it("la segunda regla, o un rol de venta, arranca sin canal", () => {
    expect(emptyRuleDraft(roles.contenido, 1).channels).toEqual([]);
    expect(emptyRuleDraft(roles.vendedor, 0).channels).toEqual([]);
    expect(emptyRuleDraft(roles.setter, 0).channels).toEqual([]);
  });
  it("un rol del negocio de pieza también", () => {
    expect(emptyRuleDraft({ key: "content_manager", payee: "content_assignee" }, 0).channels).toEqual(["organic"]);
  });
});

describe("draftFromRule → draftToInput", () => {
  it("ida y vuelta de una regla con condiciones de todo tipo", () => {
    const original = rule({
      conditions: {
        product_ids: [PROD], financing_types: ["installments"], payment_methods: ["whop"], payment_types: ["installment"], channels: ["paid"],
        platforms: ["instagram"], vendedor_ids: [ANA], sale_amount: { min: 500 }, payment_number: { from: 2, to: 4 },
        utm: { campaign: { op: "contains", values: ["webinar"] } }, meta_ad_ids: ["12345"],
      },
      valid_from: "2026-11-01", hold_days: 15, beneficiary_user_id: ANA,
    });
    const draft = draftFromRule(original, "2026-10-01T00:00:00Z");
    const result = validateRuleDraft(draft, roles.vendedor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.conditions).toEqual(original.conditions);
    expect(result.input).toMatchObject({ name: "Vendedor 12 %", calcType: "percent", rate: 12, base: "net_of_fees", holdDays: 15, validFrom: "2026-11-01", beneficiaryUserId: ANA });
  });

  it("un monto fijo no manda el porcentaje", () => {
    const draft = { ...emptyRuleDraft(roles.setter, 1), name: "Setter fijo", calcType: "fixed" as const, rate: "5", fixedAmount: "15,50" };
    const result = validateRuleDraft(draft, roles.setter);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input).toMatchObject({ calcType: "fixed", rate: null, fixedAmount: 15.5 });
  });

  it("conserva la condición vieja «la persona del rol» aunque el formulario no la edite", () => {
    const draft = draftFromRule(rule({ conditions: { user_ids: [ANA] } }), null);
    const { input } = draftToInput(draft);
    expect(input.conditions).toEqual({ user_ids: [ANA] });
  });
});

describe("validateRuleDraft", () => {
  const base = () => ({ ...emptyRuleDraft(roles.vendedor, 1), name: "Una regla", rate: "10" });

  it("sin nombre y sin porcentaje, dice cada cosa en su campo", () => {
    const result = validateRuleDraft({ ...emptyRuleDraft(roles.vendedor, 1) }, roles.vendedor);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe("Poné un nombre");
    expect(result.errors.rate).toBe("Poné el porcentaje");
  });

  it("un texto que no es un número se dice en el campo y no llega al servidor", () => {
    const result = validateRuleDraft({ ...base(), rate: "mucho", holdDays: "tres", saleAmountMin: "x" }, roles.vendedor);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["conditions.sale_amount", "holdDays", "rate"]);
  });

  it("más de 3 decimales, más de 100 % y cero", () => {
    expect(validateRuleDraft({ ...base(), rate: "2,1255" }, roles.vendedor)).toMatchObject({ ok: false, errors: { rate: "El porcentaje admite hasta 3 decimales" } });
    expect(validateRuleDraft({ ...base(), rate: "120" }, roles.vendedor)).toMatchObject({ ok: false, errors: { rate: "El porcentaje no puede pasar de 100" } });
    expect(validateRuleDraft({ ...base(), rate: "0" }, roles.vendedor)).toMatchObject({ ok: false, errors: { rate: "El porcentaje tiene que ser mayor que 0" } });
    expect(validateRuleDraft({ ...base(), rate: "2,125" }, roles.vendedor).ok).toBe(true);
  });

  it("un rol de persona fija exige la persona", () => {
    const result = validateRuleDraft({ ...base(), role: "pauta" }, roles.pauta);
    expect(result).toMatchObject({ ok: false, errors: { beneficiaryUserId: expect.stringContaining("persona fija") } });
    expect(validateRuleDraft({ ...base(), role: "pauta", beneficiaryUserId: ANA }, roles.pauta).ok).toBe(true);
  });

  it("rangos al revés y vigencia al revés", () => {
    const r1 = validateRuleDraft({ ...base(), paymentNumberFrom: "5", paymentNumberTo: "2" }, roles.vendedor);
    expect(r1).toMatchObject({ ok: false, errors: { "conditions.payment_number": expect.stringContaining("no puede ser mayor") } });
    const r2 = validateRuleDraft({ ...base(), saleAmountMin: "900", saleAmountMax: "100" }, roles.vendedor);
    expect(r2).toMatchObject({ ok: false, errors: { "conditions.sale_amount": expect.stringContaining("mínimo") } });
    const r3 = validateRuleDraft({ ...base(), validFrom: "2026-11-10", validUntil: "2026-11-01" }, roles.vendedor);
    expect(r3).toMatchObject({ ok: false, errors: { validUntil: "La vigencia termina antes de empezar" } });
  });

  it("los vacíos no se mandan: una dimensión sin valores es «cualquiera»", () => {
    const result = validateRuleDraft(base(), roles.vendedor);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.conditions).toEqual({});
  });

  it("un id de Meta con caracteres raros lo dice en su campo", () => {
    const result = validateRuleDraft({ ...base(), metaAdIds: ["no vale!"] }, roles.vendedor);
    expect(result).toMatchObject({ ok: false, errors: { "conditions.meta_ad_ids": expect.any(String) } });
  });
});

describe("previewRuleFrom", () => {
  it("arma la regla con los nombres de columna y siempre activa", () => {
    const result = validateRuleDraft({ ...emptyRuleDraft(roles.vendedor, 1), name: "X", rate: "5" }, roles.vendedor);
    if (!result.ok) throw new Error("no valida");
    const prepared = previewRuleFrom(result.input, { id: "regla-nueva", position: 3 });
    expect(prepared).toMatchObject({ id: "regla-nueva", position: 3, calc_type: "percent", rate: 5, base: "gross", is_active: true, archived_at: null, hold_days: 0 });
  });
});

describe("isDraftDirty y describeDraft", () => {
  it("detecta cambios", () => {
    const a = emptyRuleDraft(roles.vendedor, 0);
    expect(isDraftDirty(a, { ...a })).toBe(false);
    expect(isDraftDirty(a, { ...a, name: "x" })).toBe(true);
  });
  it("la frase en vivo con lo que hay, sin romper con un texto a medio escribir", () => {
    const draft = { ...emptyRuleDraft(roles.vendedor, 1), name: "X", productIds: [PROD], rate: "12", base: "net_of_fees" as const };
    expect(describeDraft(draft, { roles: { vendedor: "Vendedor" }, products: { [PROD]: "Mentoría" } })).toBe("Vendedor · Mentoría · 12 % del neto");
    expect(() => describeDraft({ ...draft, rate: "1,", saleAmountMin: "x" }, {})).not.toThrow();
  });
});

describe("addTokens", () => {
  it("suma varios separados por comas, sin repetidos ni vacíos", () => {
    expect(addTokens(["a"], "b, A, ,c\nd")).toEqual({ values: ["a", "b", "c", "d"], rejected: [] });
  });
  it("respeta el tope y el patrón", () => {
    expect(addTokens(["a", "b"], "c, d", { max: 3 })).toEqual({ values: ["a", "b", "c"], rejected: ["d"] });
    expect(addTokens([], "123, no vale", { pattern: /^[A-Za-z0-9_-]{1,40}$/ })).toEqual({ values: ["123"], rejected: ["no vale"] });
  });
});

describe("isEditConflict", () => {
  it("reconoce los dos mensajes del servidor", async () => {
    const { isEditConflict } = await import("./rules-ui-draft");
    expect(isEditConflict("Alguien cambió esta regla mientras la editabas. Recargá para ver lo último.")).toBe(true);
    expect(isEditConflict("Esta regla cambió mientras la editabas. Recargá para verla.")).toBe(true);
    expect(isEditConflict("Poné un nombre")).toBe(false);
    expect(isEditConflict(null)).toBe(false);
  });
});
