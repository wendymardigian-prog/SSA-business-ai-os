import { describe, expect, it } from "vitest";
import { checkRuleConfig, invalidDestinationIds, priorityCollisions } from "./rules";

const members = new Set(["ana", "beto"]);
const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1", name: "Campañas de Ana", priority: 1, can_reassign: false, is_active: true,
  conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "ana" }], groups: [] },
  destination: { type: "user", user_id: "ana" }, ...over,
});

describe("checkRuleConfig", () => {
  it("round_robin sin personas → 'elegí al menos una persona'", () => {
    expect(checkRuleConfig({ kind: "setter", mode: "round_robin", enabledMemberIds: [], conditionRules: [] }, members)).toEqual({ ok: false, error: "Elegí al menos una persona" });
  });

  it("el referido no admite round_robin", () => {
    expect(checkRuleConfig({ kind: "referral", mode: "round_robin", enabledMemberIds: ["ana"], conditionRules: [] }, members)).toMatchObject({ ok: false });
  });

  it("una regla por condiciones sin destino se rechaza", () => {
    const r = checkRuleConfig({ kind: "setter", mode: "condition_based", enabledMemberIds: [], conditionRules: [rule({ destination: undefined })] }, members);
    expect(r.ok).toBe(false);
  });

  it("una regla sin ninguna condición útil se rechaza (no asignaría a nadie)", () => {
    const r = checkRuleConfig({ kind: "setter", mode: "condition_based", enabledMemberIds: [], conditionRules: [rule({ conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "" }], groups: [] } })] }, members);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("al menos una condición") });
  });

  it("dos reglas activas con la misma prioridad no se pueden guardar", () => {
    const r = checkRuleConfig({ kind: "setter", mode: "condition_based", enabledMemberIds: [], conditionRules: [rule(), rule({ id: "r2", name: "Otra" })] }, members);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("misma prioridad") });
  });

  it("una persona que ya no está en el workspace se rechaza", () => {
    expect(checkRuleConfig({ kind: "setter", mode: "round_robin", enabledMemberIds: ["fantasma"], conditionRules: [] }, members)).toMatchObject({ ok: false });
    expect(checkRuleConfig({ kind: "setter", mode: "condition_based", enabledMemberIds: [], conditionRules: [rule({ destination: { type: "user", user_id: "fantasma" } })] }, members)).toMatchObject({ ok: false });
  });

  it("una configuración válida pasa y limpia las filas a medio llenar", () => {
    const r = checkRuleConfig({
      kind: "setter", mode: "condition_based", enabledMemberIds: [],
      conditionRules: [rule({ conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "ana" }, { field: "country", operator: "is", value: "" }], groups: [] } })],
    }, members);
    expect(r.ok && r.conditionRules[0].conditions.conditions).toHaveLength(1);
  });
});

describe("priorityCollisions / invalidDestinationIds", () => {
  it("un empate solo cuenta entre las activas", () => {
    expect(priorityCollisions([{ id: "a", name: "A", priority: 1, is_active: true }, { id: "b", name: "B", priority: 1, is_active: false }])).toEqual([]);
    expect(priorityCollisions([{ id: "a", name: "A", priority: 1, is_active: true }, { id: "b", name: "B", priority: 1, is_active: true }])).toHaveLength(1);
  });

  it("marca el destino inválido (persona que se fue, contacto borrado)", () => {
    const rules = [
      { ...rule(), destination: { type: "user", user_id: "fantasma" } },
      { ...rule({ id: "r2" }), destination: { type: "contact", contact_id: "c-1" } },
      { ...rule({ id: "r3" }) },
    ] as never[];
    expect(invalidDestinationIds(rules, "referral", { members, contacts: new Set() })).toEqual(["r1", "r2"]);
  });
});
