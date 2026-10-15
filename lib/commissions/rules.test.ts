/**
 * La gemela en TypeScript de las funciones SQL de elegir regla y calcular el monto: corre los casos
 * compartidos de `rules.cases.json`. (Los mismos casos corren contra la base en scripts/verify-commissions.mjs.)
 */
import { describe, expect, it } from "vitest";
import cases from "./rules.cases.json";
import { commissionAmount, evaluatePayment, explainRule, payeeFor, pickRule, ruleMatches, type RulesCase } from "./rules";
import type { CommissionFacts, CommissionRole, CommissionRule } from "./types";

const all = cases.cases as unknown as RulesCase[];

describe("evaluatePayment (casos compartidos con la función SQL)", () => {
  it.each(all.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(evaluatePayment(c.roles, c.rules, c.facts)).toEqual(c.expected);
  });

  it("hay al menos 45 casos y cada uno declara una entrada por rol activo", () => {
    expect(all.length).toBeGreaterThanOrEqual(45);
    for (const c of all) expect(c.expected.map((e) => e.role)).toEqual(c.roles.filter((r) => r.active).map((r) => r.key));
  });

  it("los nombres de los casos no se repiten", () => {
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
  });

  it("el flujo 7.1 da 38,82 / 25,00 / 15,00 en céntimos exactos", () => {
    const c = all.find((x) => x.name.startsWith("flujo 7.1"))!;
    const got = evaluatePayment(c.roles, c.rules, c.facts);
    expect(got.filter((g) => g.applies).map((g) => g.amountCents)).toEqual([3882, 2500, 1500]);
  });
});

const facts = (all.find((c) => c.name.startsWith("flujo 7.1"))!).facts as CommissionFacts;
const role = (payee: CommissionRole["payee"], key = "x"): CommissionRole => ({ key, name: key, payee, active: true, system: false, created_at: "" });
const rule = (patch: Partial<CommissionRule> = {}): CommissionRule => ({
  id: "r", name: "r", role: "x", position: 1, conditions: {}, calc_type: "percent", rate: 10, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...patch,
});

describe("ruleMatches / explainRule", () => {
  it("explainRule dice qué dimensión la dejó afuera (la primera en el orden de revisión)", () => {
    expect(explainRule(rule({ conditions: { product_ids: ["b0000000-0000-4000-8000-0000000000ff"] } }), facts, role("sale_vendedor"))).toEqual({ matched: false, failedDimension: "product_ids" });
    expect(explainRule(rule({ conditions: { utm: { campaign: { op: "contains", values: ["nada"] } } } }), facts, role("sale_vendedor"))).toEqual({ matched: false, failedDimension: "utm.campaign" });
    expect(explainRule(rule({ valid_until: "2026-01-01" }), facts, role("sale_vendedor"))).toEqual({ matched: false, failedDimension: "validity" });
    expect(explainRule(rule(), facts, role("sale_vendedor"))).toEqual({ matched: true, failedDimension: null });
  });

  it("ruleMatches y explainRule dan siempre lo mismo", () => {
    for (const c of all) {
      for (const r of c.rules) {
        const ro = c.roles.find((x) => x.key === r.role)!;
        expect(explainRule(r, c.facts, ro).matched, c.name).toBe(ruleMatches(r, c.facts, ro));
      }
    }
  });

  it("tolera condiciones nulas o mal formadas sin lanzar", () => {
    expect(ruleMatches(rule({ conditions: null as never }), facts, role("sale_vendedor"))).toBe(true);
    expect(ruleMatches(rule({ conditions: { product_ids: null as never, utm: { campaign: { op: "contains", values: null as never } } } }), facts, role("sale_vendedor"))).toBe(true);
  });
});

describe("payeeFor", () => {
  it("cada payee", () => {
    expect(payeeFor(role("sale_vendedor"), rule(), facts)).toEqual({ applies: true, userId: facts.sale.vendedor_id });
    expect(payeeFor(role("sale_setter"), rule(), facts)).toEqual({ applies: true, userId: facts.sale.setter_id });
    expect(payeeFor(role("content_assignee"), rule(), facts)).toEqual({ applies: true, userId: facts.content_assignee_id });
    expect(payeeFor(role("fixed"), rule({ beneficiary_user_id: "a0000000-0000-4000-8000-000000000004" }), facts)).toEqual({ applies: true, userId: "a0000000-0000-4000-8000-000000000004" });
    expect(payeeFor(role("fixed"), rule(), facts)).toEqual({ applies: false, userId: null });
  });
  it("sin pieza el rol de contenido no aplica; con pieza sin responsable es Sin persona", () => {
    expect(payeeFor(role("content_assignee"), rule(), { ...facts, touch: null, content_assignee_id: null })).toEqual({ applies: false, userId: null });
    expect(payeeFor(role("content_assignee"), rule(), { ...facts, content_assignee_id: null })).toEqual({ applies: true, userId: null });
  });
});

describe("pickRule", () => {
  const r = role("sale_vendedor", "vendedor");
  it("devuelve null sin reglas del rol, y la primera por position si hay varias", () => {
    expect(pickRule([], facts, r)).toBeNull();
    const a = rule({ id: "a", role: "vendedor", position: 2 });
    const b = rule({ id: "b", role: "vendedor", position: 1 });
    expect(pickRule([a, b], facts, r)?.id).toBe("b");
  });
  it("a igual position, manda el orden en que vienen", () => {
    const a = rule({ id: "a", role: "vendedor", position: 1 });
    const b = rule({ id: "b", role: "vendedor", position: 1 });
    expect(pickRule([a, b], facts, r)?.id).toBe("a");
  });
  it("no muta la lista que recibe", () => {
    const list = [rule({ id: "a", role: "vendedor", position: 2 }), rule({ id: "b", role: "vendedor", position: 1 })];
    pickRule(list, facts, r);
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("commissionAmount", () => {
  it("sin flotantes: 2,125 % de 416,67 son 885 céntimos", () => {
    const f = { ...facts, payment: { ...facts.payment, amount: 416.67, fee_amount: null } };
    expect(commissionAmount(rule({ rate: 2.125 }), f)).toEqual({ baseCents: 41667, amountCents: 885 });
  });
  it("una tasa o un monto ausentes dan cero, no NaN", () => {
    expect(commissionAmount(rule({ rate: null }), facts).amountCents).toBe(0);
    expect(commissionAmount(rule({ calc_type: "fixed", fixed_amount: null }), facts).amountCents).toBe(0);
  });
  it("el 100 % es exactamente la base", () => {
    expect(commissionAmount(rule({ rate: 100 }), facts)).toEqual({ baseCents: 50000, amountCents: 50000 });
  });
});
