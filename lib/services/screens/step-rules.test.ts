import { describe, expect, it } from "vitest";
import { checklistForm, evidenceForm, lockForm, withChecklist, withEvidence, withLock } from "./step-rules";

describe("bloqueo", () => {
  it("ida y vuelta de las tres formas", () => {
    expect(lockForm({})).toMatchObject({ mode: "any" });
    expect(withLock({ a: 1 }, { mode: "days", from: "phase_start", days: 3, afterKey: "" })).toEqual({ a: 1, lock: { from: "phase_start", days: 3 } });
    expect(lockForm({ lock: { from: "phase_start", days: 3 } })).toMatchObject({ mode: "days", from: "phase_start", days: 3 });
    expect(withLock({}, { mode: "after", from: "phase_start", days: 0, afterKey: "it_aaaaaa" })).toEqual({ lock: { after_item_key: "it_aaaaaa" } });
    expect(withLock({ lock: { from: "phase_start", days: 3 } }, { mode: "any", from: "phase_start", days: 0, afterKey: "" })).toEqual({});
  });
  it("recorta los días a 0..365", () => {
    expect(withLock({}, { mode: "days", from: "service_start", days: 900, afterKey: "" })).toEqual({ lock: { from: "service_start", days: 365 } });
  });
});

describe("evidencia y checklist", () => {
  it("evidencia: sin tipos elegidos pide los tres; apagada se saca", () => {
    expect(withEvidence({}, true, [])).toEqual({ evidence: { required: true, kinds: ["file", "link", "note"] } });
    expect(evidenceForm(withEvidence({}, true, ["file"]))).toEqual({ required: true, kinds: ["file"] });
    expect(withEvidence({ evidence: { required: true, kinds: ["file"] } }, false, ["file"])).toEqual({});
  });
  it("checklist: sin puntos vacíos y hasta 20", () => {
    expect(withChecklist({}, [" Uno ", "", "Dos"])).toEqual({ checklist: ["Uno", "Dos"] });
    expect(withChecklist({ checklist: ["x"] }, ["  "])).toEqual({});
    expect(checklistForm(withChecklist({}, Array.from({ length: 25 }, (_, i) => `P${i}`)))).toHaveLength(20);
  });
});
