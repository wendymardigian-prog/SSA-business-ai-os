// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import advance from "./advance.cases.json";
import autoCreation from "./auto-creation.cases.json";
import due from "./due.cases.json";
import extend from "./extend.cases.json";
import light from "./light.cases.json";
import ownerPick from "./owner-pick.cases.json";
import pause from "./pause.cases.json";
import recurrence from "./recurrence.cases.json";
import renewal from "./renewal.cases.json";
import {
  addMonths,
  computeLight,
  dueDate,
  extendPlan,
  occurrenceDates,
  phaseShouldAdvance,
  pickOwner,
  renewalPlan,
  resumeDays,
  ruleMet,
  type ExtendInput,
  type LightInput,
  type OwnerPickInput,
  type Recurrence,
  type RenewalInput,
  type RuleInput,
} from "./engine-rules";

describe("ruleMet (gemela de svc_rule_met)", () => {
  for (const c of autoCreation.cases) it(c.name, () => expect(ruleMet(c.input as RuleInput)).toBe(c.expected));
});

describe("renewalPlan (gemela de svc_renewal_plan)", () => {
  for (const c of renewal.cases) it(c.name, () => expect(renewalPlan(c.input as RenewalInput)).toEqual(c.expected));
});

describe("dueDate (gemela de svc_due_date)", () => {
  for (const c of due.cases) it(c.name, () => expect(dueDate(c.rule, c.anchors)).toBe(c.expected));
});

describe("phaseShouldAdvance (gemela de svc_phase_should_advance)", () => {
  for (const c of advance.cases) {
    const [a, rt, rd, at, ad] = c.input as [string, number, number, number, number];
    it(c.name, () => expect(phaseShouldAdvance(a, rt, rd, at, ad)).toBe(c.expected));
  }
});

describe("occurrenceDates (gemela de svc_occurrence_dates)", () => {
  for (const c of recurrence.cases) {
    it(c.name, () => expect(occurrenceDates(c.recurrence as Recurrence, c.start, c.phaseEnd, c.serviceEnd, c.upTo)).toEqual(c.expected));
  }
  it("el cron dos veces el mismo dia da lo mismo (no duplica)", () => {
    const r: Recurrence = { every: "week", until: "n_days", n_until: 30 };
    expect(occurrenceDates(r, "2026-11-02", null, null, "2026-11-09")).toEqual(occurrenceDates(r, "2026-11-02", null, null, "2026-11-09"));
  });
});

describe("computeLight (gemela de svc_light)", () => {
  it("tiene al menos 28 casos", () => expect(light.cases.length).toBeGreaterThanOrEqual(28));
  for (const c of light.cases) it(c.name, () => expect(computeLight(c.input as LightInput)).toEqual(c.expected));
});

describe("extendPlan (gemela de svc_extend_plan)", () => {
  for (const c of extend.cases) it(c.name, () => expect(extendPlan(c.input as ExtendInput)).toEqual(c.expected));
  it("sumar meses como Postgres: 31/1 + 1 mes = 28/2", () => expect(addMonths("2027-01-31", 1)).toBe("2027-02-28"));
});

describe("resumeDays (gemela de svc_resume_plan)", () => {
  for (const c of pause.cases) it(c.name, () => expect(resumeDays(c.pausedAt, c.now, c.shiftDays)).toBe(c.expected));
});

describe("pickOwner (gemela de svc_owner_pick_plan)", () => {
  for (const c of ownerPick.cases) it(c.name, () => expect(pickOwner(c.input as OwnerPickInput)).toEqual(c.expected));
});
