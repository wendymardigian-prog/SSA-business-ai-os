import { describe, expect, it } from "vitest";
import { resolveAssignments, type ContactForResolve } from "./resolve";
import { dryRunAssignments, skipReasonText } from "./dry-run";
import type { AssignmentRuleRow, ConditionRule } from "./types";

const ANA = "ana";
const BETO = "beto";
const CARLA = "carla";
const active = new Set([ANA, BETO, CARLA]);

const contact = (over: Partial<ContactForResolve> = {}): ContactForResolve => ({
  setter_id: null, vendedor_id: null, referred_by_user_id: null, referred_by_contact_id: null, assignment_locked_at: null,
  attribution: { version: 2, last_touch: { source: "instagram", medium: "paid_social", campaign: "campañas-de-ana" } },
  country: "CR", email: "x@y.co", phone: null, whatsapp_phone: null, ...over,
});

const rule = (over: Partial<ConditionRule> = {}): ConditionRule => ({
  id: "r1", name: "Campañas de Ana", priority: 1, can_reassign: false, is_active: true,
  conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "ana" }], groups: [] },
  destination: { type: "user", user_id: ANA }, ...over,
});

const row = (kind: AssignmentRuleRow["kind"], over: Partial<AssignmentRuleRow> = {}): AssignmentRuleRow => ({
  id: `ar-${kind}`, kind, mode: "condition_based", enabled_member_ids: [], last_assigned_member_id: null, condition_rules: [rule()], ...over,
});

describe("resolveAssignments", () => {
  it("un contacto sin setter y una regla que coincide → setter = Ana, con el nombre de la regla", () => {
    const r = resolveAssignments(contact(), { setter: row("setter") }, active);
    expect(r.setter_id).toBe(ANA);
    expect(r.applied).toEqual([{ kind: "setter", ruleId: "r1", ruleName: "Campañas de Ana", destination: { type: "user", id: ANA } }]);
  });

  it("un contacto que ya tiene setter y una regla sin 'puede reasignar' → no cambia", () => {
    const r = resolveAssignments(contact({ setter_id: BETO }), { setter: row("setter") }, active);
    expect(r.setter_id).toBeUndefined();
    expect(r.applied).toEqual([]);
    expect(r.skipped).toContainEqual({ kind: "setter", reason: "filled" });
  });

  it("con 'puede reasignar', pisa al que ya está", () => {
    const r = resolveAssignments(contact({ setter_id: BETO }), { setter: row("setter", { condition_rules: [rule({ can_reassign: true })] }) }, active);
    expect(r.setter_id).toBe(ANA);
  });

  it("assignment_locked_at: ni siquiera una regla con 'puede reasignar' toca setter ni vendedor", () => {
    const rules = { setter: row("setter", { condition_rules: [rule({ can_reassign: true })] }), vendedor: row("vendedor", { condition_rules: [rule({ can_reassign: true })] }) };
    const r = resolveAssignments(contact({ setter_id: BETO, assignment_locked_at: "2026-10-01T00:00:00Z" }), rules, active);
    expect(r.setter_id).toBeUndefined();
    expect(r.vendedor_id).toBeUndefined();
    expect(r.skipped.filter((s) => s.reason === "locked").map((s) => s.kind)).toEqual(["setter", "vendedor"]);
  });

  it("ninguna regla coincide → no se escribe nada", () => {
    const r = resolveAssignments(contact({ attribution: { version: 2, last_touch: { source: "google" } } }), { setter: row("setter") }, active);
    expect(r).toMatchObject({ applied: [], pointerUpdates: [] });
    expect(r.setter_id).toBeUndefined();
    expect(r.skipped).toContainEqual({ kind: "setter", reason: "no_match" });
  });

  it("todo en manual no asigna nada", () => {
    const rules = { setter: row("setter", { mode: "manual" }), vendedor: row("vendedor", { mode: "manual" }), referral: row("referral", { mode: "manual" }) };
    const r = resolveAssignments(contact(), rules, active);
    expect(r.applied).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["manual", "manual", "manual"]);
  });

  it("el modo reparto equitativo asigna al siguiente y avanza el puntero de la regla", () => {
    const rules = { vendedor: row("vendedor", { mode: "round_robin", enabled_member_ids: [ANA, BETO, CARLA], last_assigned_member_id: ANA }) };
    const r = resolveAssignments(contact(), rules, active);
    expect(r.vendedor_id).toBe(BETO);
    expect(r.pointerUpdates).toEqual([{ kind: "vendedor", assignmentRuleId: "ar-vendedor", scope: "mode", lastAssignedMemberId: BETO }]);
  });

  it("un destino round robin dentro de una regla avanza el last_index DE ESA REGLA", () => {
    const rr = rule({ destination: { type: "round_robin", members: [ANA, BETO], last_index: 0 } });
    const r = resolveAssignments(contact(), { vendedor: row("vendedor", { condition_rules: [rr] }) }, active);
    expect(r.vendedor_id).toBe(BETO);
    expect(r.pointerUpdates).toEqual([{ kind: "vendedor", assignmentRuleId: "ar-vendedor", scope: "rule", conditionRuleId: "r1", lastIndex: 1 }]);
  });

  it("gana la regla de menor prioridad; una inactiva o con destino inválido se saltea", () => {
    const rules = [
      rule({ id: "inactiva", priority: 0, is_active: false, destination: { type: "user", user_id: CARLA } }),
      rule({ id: "invalida", priority: 1, destination: { type: "user", user_id: "se-fue" } }),
      rule({ id: "buena", priority: 2, name: "La buena", destination: { type: "user", user_id: BETO } }),
      rule({ id: "tarde", priority: 3, destination: { type: "user", user_id: CARLA } }),
    ];
    const r = resolveAssignments(contact(), { setter: row("setter", { condition_rules: rules }) }, active);
    expect(r.setter_id).toBe(BETO);
    expect(r.applied[0].ruleName).toBe("La buena");
  });

  it("reasignar a la persona que ya está no es un cambio", () => {
    const r = resolveAssignments(contact({ setter_id: ANA }), { setter: row("setter", { condition_rules: [rule({ can_reassign: true })] }) }, active);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toContainEqual({ kind: "setter", reason: "same" });
  });

  it("referido: un destino contacto escribe referred_by_contact_id y solo si el contacto existe; no se reparte por turnos", () => {
    const toContact = rule({ destination: { type: "contact", contact_id: "c-9" } });
    const ok = resolveAssignments(contact(), { referral: row("referral", { condition_rules: [toContact] }) }, active, { validContactIds: new Set(["c-9"]) });
    expect(ok.referred_by_contact_id).toBe("c-9");
    const gone = resolveAssignments(contact(), { referral: row("referral", { condition_rules: [toContact] }) }, active, { validContactIds: new Set() });
    expect(gone.referred_by_contact_id).toBeUndefined();
    const rr = resolveAssignments(contact(), { referral: row("referral", { mode: "round_robin", enabled_member_ids: [ANA] }) }, active);
    expect(rr.referred_by_user_id).toBeUndefined();
  });

  it("el referido NO se bloquea por la asignación a mano de setter o vendedor", () => {
    const user = rule({ destination: { type: "user", user_id: ANA } });
    const r = resolveAssignments(contact({ assignment_locked_at: "2026-10-01T00:00:00Z" }), { referral: row("referral", { condition_rules: [user] }) }, active);
    expect(r.referred_by_user_id).toBe(ANA);
  });
});

describe("dryRunAssignments", () => {
  it("coincide con lo que resolveAssignments haría para el mismo contacto", () => {
    const rules = { setter: row("setter"), vendedor: row("vendedor", { mode: "round_robin", enabled_member_ids: [BETO] }) };
    const c = contact();
    const resolution = resolveAssignments(c, rules, active);
    const rows = dryRunAssignments(c, rules, active);
    expect(rows.filter((x) => x.applies).map((x) => [x.kind, x.wouldAssign?.id])).toEqual(resolution.applied.map((a) => [a.kind, a.destination.id]));
  });

  it("dice por qué no se aplicaría: campo lleno y asignado a mano", () => {
    const lleno = dryRunAssignments(contact({ vendedor_id: BETO }), { vendedor: row("vendedor") }, active).find((x) => x.kind === "vendedor")!;
    expect(lleno).toMatchObject({ applies: false, wouldAssign: { id: ANA }, reasonText: "no se aplicaría: ya tiene vendedor" });
    const mano = dryRunAssignments(contact({ assignment_locked_at: "2026-10-01T00:00:00Z" }), { setter: row("setter") }, active).find((x) => x.kind === "setter")!;
    expect(mano.reasonText).toBe("no se aplicaría: asignado a mano");
    expect(skipReasonText("referral", "no_match")).toBe("ninguna regla coincide");
  });

  it("NO escribe: no recibe ningún cliente y su entrada no se modifica", () => {
    const c = contact();
    const before = JSON.stringify(c);
    dryRunAssignments(c, { setter: row("setter") }, active);
    expect(JSON.stringify(c)).toBe(before);
  });
});
