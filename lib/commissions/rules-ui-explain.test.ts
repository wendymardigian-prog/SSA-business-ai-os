import { describe, expect, it } from "vitest";
import { buildCommissionPreview } from "./preview";
import { defaultCommissionRoles } from "./roles";
import { factsSummary, previewRoleView, skipReasonText } from "./rules-ui-explain";
import type { CommissionFacts, CommissionRule } from "./types";

const ANA = "33333333-3333-4333-8333-333333333333";
const LUIS = "44444444-4444-4444-8444-444444444444";
const MENTORIA = "98888888-8888-4888-8888-888888888881";
const CURSO = "98888888-8888-4888-8888-888888888882";

const lookups = {
  roles: { vendedor: "Vendedor" },
  products: { [MENTORIA]: "Mentoría", [CURSO]: "Curso" },
  people: { [ANA]: "Ana", [LUIS]: "Luis" },
  methods: { whop: "Whop", wise: "Wise" },
};

const facts = (over: Partial<CommissionFacts> = {}): CommissionFacts => ({
  payment: { id: "p1", type: "installment", amount: 500, paid_on: "2026-10-15", method: "wise", fee_amount: null, number: 1 },
  sale: { id: "s1", status: "paid", financing_type: "full", final_amount: 500, product_id: CURSO, variant_id: null, setter_id: null, vendedor_id: LUIS, contact_id: null },
  touch: { id: "t1", channel: "organic", source: "instagram", medium: null, campaign: "black friday", content: null, term: null, content_post_id: null, social_post_id: null, meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null },
  content_assignee_id: null,
  ...over,
});

const rule = (over: Partial<CommissionRule> = {}): CommissionRule => ({
  id: "d1000000-0000-4000-8000-000000000000", name: "Regla", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 10, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...over,
});

const skippedFor = (r: CommissionRule, f: CommissionFacts = facts()) => {
  const roles = defaultCommissionRoles().filter((x) => x.key === "vendedor");
  const preview = buildCommissionPreview({ roles, rules: [r], facts: f, names: new Map() });
  const first = preview.roles[0].skipped[0];
  return first ? skipReasonText(first, r, f, lookups) : null;
};

describe("skipReasonText", () => {
  it("producto", () => {
    expect(skippedFor(rule({ conditions: { product_ids: [MENTORIA] } }))).toBe("No es del producto Mentoría (esta venta es de Curso)");
  });
  it("vendedor", () => {
    expect(skippedFor(rule({ conditions: { vendedor_ids: [ANA] } }))).toBe("El vendedor no es Ana (en esta venta es Luis)");
    expect(skippedFor(rule({ conditions: { vendedor_ids: [ANA] } }), facts({ sale: { ...facts().sale, vendedor_id: null } }))).toBe("El vendedor no es Ana (esta venta no tiene vendedor)");
  });
  it("financiamiento, método y tipo de pago", () => {
    expect(skippedFor(rule({ conditions: { financing_types: ["installments"] } }))).toBe("El financiamiento no es cuotas (esta venta es pago completo)");
    expect(skippedFor(rule({ conditions: { payment_methods: ["whop"] } }))).toBe("El método no es Whop (este cobro fue por Wise)");
    expect(skippedFor(rule({ conditions: { payment_types: ["full"] } }))).toBe("El pago no es un pago único (este cobro es una cuota)");
  });
  it("canal, red y UTM", () => {
    expect(skippedFor(rule({ conditions: { channels: ["paid"] } }))).toBe("El canal no es pautado (esta venta llegó por un canal orgánico)");
    expect(skippedFor(rule({ conditions: { channels: ["paid"] } }), facts({ touch: null }))).toBe("El canal no es pautado (esta venta no tiene atribución, cuenta como directa)");
    expect(skippedFor(rule({ conditions: { platforms: ["tiktok"] } }))).toBe("La red no es Tiktok (la fuente de esta venta es instagram)");
    expect(skippedFor(rule({ conditions: { utm: { campaign: { op: "contains", values: ["webinar"] } } } }))).toBe("La campaña no contiene «webinar» (esta venta trae «black friday»)");
    expect(skippedFor(rule({ conditions: { utm: { term: { op: "equals", values: ["curso"] } } } }))).toBe("El término no es «curso» (esta venta no trae término)");
  });
  it("número de pago, monto y vigencia", () => {
    expect(skippedFor(rule({ conditions: { payment_number: { from: 2, to: 4 } } }))).toBe("El número de pago no está entre el 2 y el 4 (este es el pago 1)");
    expect(skippedFor(rule({ conditions: { sale_amount: { min: 1000 } } }))).toBe("El monto de la venta no está desde USD 1.000,00 (esta venta es de USD 500,00)");
    expect(skippedFor(rule({ valid_from: "2026-11-01" }))).toBe("La regla vale desde el 1/11 (este cobro es del 15/10)");
  });
  it("sin la regla, cae al texto del servidor", () => {
    expect(skipReasonText({ ruleId: "x", name: "R", position: 1, dimension: "product_ids", reason: "No matchea por el producto" }, undefined, facts())).toBe("No matchea por el producto");
  });
});

describe("previewRoleView", () => {
  const roles = defaultCommissionRoles().filter((r) => r.key === "vendedor");
  const run = (rules: CommissionRule[], f = facts()) => {
    const preview = buildCommissionPreview({ roles, rules, facts: f, names: new Map([[LUIS, "Luis"]]), draftIds: new Set(["draft"]) });
    return previewRoleView(preview.roles[0], new Map(rules.map((r) => [r.id, r])), f, lookups);
  };

  it("la regla que gana, la persona, la base y el monto; y las de arriba que no matchearon", () => {
    const view = run([rule({ id: "r1", name: "Solo Mentoría", position: 1, conditions: { product_ids: [MENTORIA] } }), rule({ id: "r2", name: "Vendedor 10 %", position: 2 })]);
    expect(view).toMatchObject({ tone: "pays", headline: "Luis cobraría USD 50,00", detail: "Gana «Vendedor 10 %» (lugar 2) · base USD 500,00", draft: false });
    expect(view.skipped).toEqual([{ id: "r1", title: "Solo Mentoría (lugar 1)", text: "No es del producto Mentoría (esta venta es de Curso)" }]);
  });
  it("sin ninguna regla que matchee", () => {
    const view = run([rule({ conditions: { product_ids: [MENTORIA] } })]);
    expect(view).toMatchObject({ tone: "none", headline: "No genera comisión", detail: "Ninguna regla de este rol matchea con este cobro" });
    expect(view.skipped).toHaveLength(1);
  });
  it("marca la regla sin guardar y la retención", () => {
    const view = run([rule({ id: "draft", name: "Nueva", hold_days: 7 })]);
    expect(view.draft).toBe(true);
    expect(view.detail).toContain("se retiene 7 días");
  });
  it("sin persona a quien pagarle", () => {
    const view = run([rule()], facts({ sale: { ...facts().sale, vendedor_id: null } }));
    expect(view.tone).toBe("warn");
    expect(view.headline).toContain("no hay a quién pagarle");
  });
});

describe("factsSummary", () => {
  it("resume el cobro", () => {
    expect(factsSummary(facts(), lookups)).toBe("USD 500,00 · pago 1 · Curso · Wise · canal orgánico · instagram");
  });
});
