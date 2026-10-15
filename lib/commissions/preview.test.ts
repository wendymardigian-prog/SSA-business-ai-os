import { describe, expect, it } from "vitest";
import cases from "./rules.cases.json";
import { evaluatePayment, type RulesCase } from "./rules";
import { buildCommissionPreview, hypotheticalFacts, mergeDraftRules, parseDraftRules, previewInputSchema, type HypotheticalSale } from "./preview";
import type { CommissionFacts, CommissionRole, CommissionRule } from "./types";

const all = cases.cases as unknown as RulesCase[];
const flow71 = all.find((c) => c.name.startsWith("flujo 7.1"))!;

describe("buildCommissionPreview", () => {
  it("coincide con evaluatePayment en todos los casos compartidos (salvo el monto en cero, que la base no genera)", () => {
    for (const c of all) {
      const preview = buildCommissionPreview({ roles: c.roles, rules: c.rules, facts: c.facts });
      expect(preview.roles.map((r) => r.roleKey), c.name).toEqual(c.expected.map((e) => e.role));
      preview.roles.forEach((got, i) => {
        const want = c.expected[i];
        expect(got.rule?.id ?? null, c.name).toBe(want.ruleId);
        if (want.applies && want.amountCents <= 0) {
          expect(got.applies, c.name).toBe(false);
          expect(got.reason, c.name).toBe("zero_amount");
          return;
        }
        expect(got.applies, c.name).toBe(want.applies);
        if (want.applies) {
          expect(got.userId, c.name).toBe(want.userId);
          expect(got.baseCents, c.name).toBe(want.baseCents);
          expect(got.amountCents, c.name).toBe(want.amountCents);
        }
      });
    }
  });

  it("el flujo 7.1 da 38,82 / 25,00 / 15,00 con la persona y la regla de cada rol", () => {
    const names = new Map([
      ["a0000000-0000-4000-8000-000000000001", "Ana"],
      ["a0000000-0000-4000-8000-000000000002", "Beto"],
      ["a0000000-0000-4000-8000-000000000003", "Carla"],
    ]);
    const preview = buildCommissionPreview({ roles: flow71.roles, rules: flow71.rules, facts: flow71.facts, names });
    const applied = preview.roles.filter((r) => r.applies);
    expect(applied.map((r) => [r.roleKey, r.amountCents, r.userName])).toEqual([["vendedor", 3882, "Ana"], ["setter", 2500, "Beto"], ["contenido", 1500, "Carla"]]);
    expect(preview.totalCents).toBe(3882 + 2500 + 1500);
    const pauta = preview.roles.find((r) => r.roleKey === "pauta")!;
    expect(pauta).toMatchObject({ applies: false, reason: "no_rule", rule: null });
  });

  it("dice qué regla de arriba quedó afuera y por qué dimensión", () => {
    const vendedor = flow71.roles[0];
    const above: CommissionRule = { ...flow71.rules[0], id: "above", name: "Solo Mentoría", position: 1, conditions: { product_ids: ["b0000000-0000-4000-8000-0000000000ff"] }, rate: 50 };
    const winner = { ...flow71.rules[0], position: 2 };
    const preview = buildCommissionPreview({ roles: [vendedor], rules: [winner, above], facts: flow71.facts });
    const row = preview.roles[0];
    expect(row.rule?.id).toBe(winner.id);
    expect(row.skipped).toEqual([{ ruleId: "above", name: "Solo Mentoría", position: 1, dimension: "product_ids", reason: "No matchea por el producto" }]);
  });

  it("sin ganadora, lista TODAS las reglas del rol que no matchearon; una pausada o archivada no cuenta", () => {
    const vendedor = flow71.roles[0];
    const mk = (id: string, patch: Partial<CommissionRule>): CommissionRule => ({ ...flow71.rules[0], id, role: "vendedor", conditions: { payment_methods: ["stripe"] }, ...patch });
    const preview = buildCommissionPreview({
      roles: [vendedor],
      rules: [mk("a", { position: 1 }), mk("b", { position: 2, conditions: { variant_ids: ["b1000000-0000-4000-8000-0000000000ff"] } }), mk("p", { position: 3, is_active: false }), mk("z", { position: 4, archived_at: "2026-01-01" })],
      facts: flow71.facts,
    });
    expect(preview.roles[0].rule).toBeNull();
    expect(preview.roles[0].reason).toBe("no_rule");
    expect(preview.roles[0].skipped.map((s) => [s.ruleId, s.dimension])).toEqual([["a", "payment_methods"], ["b", "variant_ids"]]);
  });

  it("un rol desactivado no aparece", () => {
    const roles: CommissionRole[] = flow71.roles.map((r) => (r.key === "setter" ? { ...r, active: false } : r));
    expect(buildCommissionPreview({ roles, rules: flow71.rules, facts: flow71.facts }).roles.map((r) => r.roleKey)).toEqual(["vendedor", "contenido", "pauta"]);
  });

  it("una regla que matchea pero sin a quién pagarle dice «not_applicable»; una pieza sin responsable queda «Sin persona»", () => {
    const facts: CommissionFacts = { ...flow71.facts, sale: { ...flow71.facts.sale, setter_id: null }, content_assignee_id: null };
    const preview = buildCommissionPreview({ roles: flow71.roles, rules: flow71.rules, facts });
    expect(preview.roles.find((r) => r.roleKey === "setter")).toMatchObject({ applies: false, reason: "not_applicable", rule: { id: "d0000000-0000-4000-8000-000000000002" } });
    expect(preview.roles.find((r) => r.roleKey === "contenido")).toMatchObject({ applies: true, reason: "no_person", userId: null, amountCents: 1500 });
  });

  it("marca las reglas que vienen de la pantalla sin guardar", () => {
    const draft = { ...flow71.rules[1], id: "draft-1", position: 1, rate: 7 };
    const saved = flow71.rules.map((r) => (r.id === flow71.rules[1].id ? { ...r, position: 2 } : r));
    const rules = mergeDraftRules(saved, [draft]);
    const preview = buildCommissionPreview({ roles: flow71.roles, rules, facts: flow71.facts, draftIds: new Set(["draft-1"]) });
    expect(preview.roles.find((r) => r.roleKey === "setter")).toMatchObject({ rule: { id: "draft-1", draft: true }, amountCents: 3500 });
  });
});

describe("mergeDraftRules", () => {
  const saved = [{ ...flow71.rules[0], id: "a" }, { ...flow71.rules[1], id: "b" }];
  it("reemplaza por id y suma las nuevas", () => {
    const merged = mergeDraftRules(saved, [{ ...saved[0], rate: 99 }, { ...saved[1], id: "nueva" }]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "nueva"]);
    expect(merged[0].rate).toBe(99);
  });
  it("sin borradores devuelve una copia de las guardadas", () => {
    const merged = mergeDraftRules(saved, undefined);
    expect(merged).toEqual(saved);
    expect(merged).not.toBe(saved);
  });
});

describe("hypotheticalFacts", () => {
  const sale: HypotheticalSale = {
    id: "s1", status: "pending_payment", financing_type: "reservation_installments", final_amount: 1500, product_variant_id: "v1", product_id: "p1", setter_id: "u2", vendedor_id: "u1", contact_id: "c1",
  };
  const base = { sale, touch: null, contentAssigneeId: null, livePayments: 0, amountCents: 50000, method: "whop", feeAmount: 14.8, todayLocal: "2026-10-15" };

  it("el primer pago sigue el financiamiento y el resto son cuotas; el número es el siguiente a los vivos", () => {
    expect(hypotheticalFacts(base).payment).toMatchObject({ type: "reservation", number: 1, amount: 500, method: "whop", fee_amount: 14.8, paid_on: "2026-10-15" });
    expect(hypotheticalFacts({ ...base, livePayments: 2 }).payment).toMatchObject({ type: "installment", number: 3 });
    expect(hypotheticalFacts({ ...base, sale: { ...sale, financing_type: "full" } }).payment.type).toBe("full");
  });

  it("la venta y el toque tienen la misma forma que commission_facts (UTM decodificados y sin vacíos)", () => {
    const facts = hypotheticalFacts({
      ...base,
      touch: { id: "t1", channel: "paid", source: "instagram", medium: "cpc", campaign: "Black%20Friday", content_label: "  ", term: null, content_post_id: "post", social_post_id: null, meta_ad_id: "ad1", meta_adset_id: null, meta_campaign_id: "cmp1" },
      contentAssigneeId: "u3",
    });
    expect(facts.sale).toEqual({ id: "s1", status: "pending_payment", financing_type: "reservation_installments", final_amount: 1500, product_id: "p1", variant_id: "v1", setter_id: "u2", vendedor_id: "u1", contact_id: "c1" });
    expect(facts.touch).toMatchObject({ id: "t1", campaign: "Black Friday", content: null, term: null, meta_ad_id: "ad1" });
    expect(facts.content_assignee_id).toBe("u3");
  });

  it("sin pieza en el toque, no hay responsable de contenido aunque se pase uno", () => {
    const facts = hypotheticalFacts({ ...base, touch: { id: "t", channel: "organic", source: "x", medium: null, campaign: null, content_label: null, term: null, content_post_id: null, social_post_id: null, meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null }, contentAssigneeId: "u3" });
    expect(facts.content_assignee_id).toBeNull();
    expect(hypotheticalFacts(base).touch).toBeNull();
  });
});

describe("lo que manda la pantalla", () => {
  it("previewInputSchema acepta un cobro o una venta con monto", () => {
    expect(previewInputSchema.safeParse({ paymentId: "a0000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(previewInputSchema.safeParse({ saleId: "a0000000-0000-4000-8000-000000000001", amountCents: 5000, method: "whop" }).success).toBe(true);
    expect(previewInputSchema.safeParse({ saleId: "a0000000-0000-4000-8000-000000000001", amountCents: 0, method: null }).success).toBe(false);
    expect(previewInputSchema.safeParse({ saleId: "x", amountCents: 5000 }).success).toBe(false);
    expect(previewInputSchema.safeParse({}).success).toBe(false);
  });

  it("parseDraftRules valida las condiciones y rechaza dimensiones que no existen", () => {
    const ok = parseDraftRules([{ id: "draft-1", name: "x", role: "vendedor", position: 1, conditions: { channels: ["organic"] }, calc_type: "percent", rate: 5, base: "gross", is_active: true }]);
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.rules[0]).toMatchObject({ fixed_amount: null, hold_days: 0, valid_from: null, archived_at: null });
    expect(parseDraftRules([{ id: "d", role: "vendedor", position: 1, conditions: { inventada: ["x"] }, calc_type: "percent", rate: 5 }]).ok).toBe(false);
    expect(parseDraftRules("no es una lista").ok).toBe(false);
    expect(parseDraftRules(undefined)).toEqual({ ok: true, rules: [] });
  });
});
