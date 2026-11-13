import { describe, expect, it } from "vitest";
import { recordStepRules } from "./record-step-rules";

const toLocal = (iso: string) => iso.slice(0, 10);
const svc = { created_at: "2026-11-01T10:00:00Z", starts_on: "2026-11-02" };
const phases = [{ id: "ph1", started_at: "2026-11-05T12:00:00Z" }];

describe("recordStepRules", () => {
  it("candado por días, por otro paso y sin candado; lo completo nunca queda bloqueado", () => {
    const items = [
      { id: "a", phase_id: "ph1", template_key: "it_a", status: "pending", ref: { lock: { from: "phase_start", days: 3 } }, evidence: [] },
      { id: "b", phase_id: "ph1", template_key: "it_b", status: "pending", ref: { lock: { after_item_key: "it_a" } }, evidence: [] },
      { id: "c", phase_id: "ph1", template_key: "it_c", status: "completed", ref: { lock: { after_item_key: "it_a" } }, evidence: [] },
      { id: "d", phase_id: "ph1", template_key: "it_d", status: "pending", ref: null, evidence: null },
    ];
    const r = recordStepRules(items, phases, svc, "2026-11-06", toLocal);
    expect(r.get("a")!.lock).toEqual({ locked: true, until: "2026-11-08", waiting_item_key: null });
    expect(r.get("b")!.lock).toEqual({ locked: true, until: null, waiting_item_key: "it_a" });
    expect(r.get("c")!.lock.locked).toBe(false);
    expect(r.get("d")!.lock.locked).toBe(false);
    expect(recordStepRules(items, phases, svc, "2026-11-08", toLocal).get("a")!.lock.locked).toBe(false);
  });

  it("evidencia que falta solo con el paso pendiente y la regla prendida", () => {
    const rule = { evidence: { required: true, kinds: ["link"] } };
    const items = [
      { id: "a", phase_id: "ph1", template_key: "it_a", status: "pending", ref: rule, evidence: [] },
      { id: "b", phase_id: "ph1", template_key: "it_b", status: "pending", ref: rule, evidence: [{ id: "e1", kind: "link", url: "https://x.y", by: "u", at: "t" }] },
      { id: "c", phase_id: "ph1", template_key: "it_c", status: "completed", ref: rule, evidence: [] },
    ];
    const r = recordStepRules(items, phases, svc, "2026-11-06", toLocal);
    expect(r.get("a")!.evidenceMissing).toBe(true);
    expect(r.get("b")!.evidenceMissing).toBe(false);
    expect(r.get("c")!.evidenceMissing).toBe(false);
  });
});
