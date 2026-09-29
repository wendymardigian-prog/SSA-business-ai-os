import { describe, expect, it } from "vitest";
import { agentActionRows, escalationReasons, ruleResultRows } from "./escalations";

describe("escalationReasons", () => {
  it("un motivo del modelo se muestra como lo escribio, con mayuscula", () => {
    const [r] = escalationReasons([
      { reason_key: "pidio hablar con una persona", reason_label: "pidió hablar con una persona", origin: "tool", escalations: 31, pct: 31, is_other: false },
    ]);
    expect(r.label).toBe("Pidió hablar con una persona");
    expect(r.count).toBe(31);
  });

  it("una clave de guardarrail se traduce, no se muestra cruda", () => {
    const [r] = escalationReasons([
      { reason_key: "guardrail:blocked_topic", reason_label: "guardrail:blocked_topic", origin: "guardrail", escalations: 4, pct: 10, is_other: false },
    ]);
    expect(r.label).not.toContain("guardrail:");
    expect(r.label.length).toBeGreaterThan(5);
  });

  it("sin motivo anotado lo dice", () => {
    const [r] = escalationReasons([{ reason_key: "sin_motivo", reason_label: "", origin: "tool", escalations: 2, pct: 5, is_other: false }]);
    expect(r.label).toBe("Sin motivo anotado");
  });

  it("la fila de resto se llama Otros motivos", () => {
    const [r] = escalationReasons([{ reason_key: "otros", reason_label: "Otros motivos", origin: null, escalations: 9, pct: 9, is_other: true }]);
    expect(r.label).toBe("Otros motivos");
    expect(r.isOther).toBe(true);
  });
});

describe("ruleResultRows", () => {
  const rules = [{ id: "r1", name: "botón conocido" }, { id: "r2", name: null }, { id: "r3", name: "menciona precio" }];

  it("se lee como una oracion, nunca el id", () => {
    const rows = ruleResultRows([{ rule_id: "r3", rule_index: 2, action: "draft", runs: 12, degraded_to_draft: 0, is_default: false }], rules);
    expect(rows[0].label).toBe("Regla 3 · menciona precio");
    expect(rows[0].label).not.toContain("r3");
    expect(rows[0].actionLabel).toBe("quedaron en borrador");
  });

  it("una regla sin nombre se muestra por su numero", () => {
    const rows = ruleResultRows([{ rule_id: "r2", rule_index: 1, action: "send", runs: 3, degraded_to_draft: 1, is_default: false }], rules);
    expect(rows[0].label).toBe("Regla 2");
    expect(rows[0].degradedToDraft).toBe(1);
  });

  it("la accion por defecto se explica", () => {
    const rows = ruleResultRows([{ rule_id: null, rule_index: null, action: "draft", runs: 7, degraded_to_draft: 0, is_default: true }], rules);
    expect(rows[0].label).toContain("Acción por defecto");
  });

  it("una regla borrada despues de correr no desaparece", () => {
    const rows = ruleResultRows([{ rule_id: "r9", rule_index: 8, action: "skip", runs: 2, degraded_to_draft: 0, is_default: false }], rules);
    expect(rows[0].label).toBe("Regla 9");
  });

  it("una regla borrada y sin indice lo dice", () => {
    const rows = ruleResultRows([{ rule_id: "r9", rule_index: null, action: "skip", runs: 2, degraded_to_draft: 0, is_default: false }], rules);
    expect(rows[0].label).toBe("Una regla que ya no existe");
  });
});

describe("agentActionRows", () => {
  it("traduce las acciones conocidas", () => {
    const rows = agentActionRows([{ action: "tag", actions: 389, reverted: 2 }, { action: "human_takeover", actions: 68, reverted: 0 }]);
    expect(rows[0].label).toBe("Etiquetó");
    expect(rows[0].reverted).toBe(2);
    expect(rows[1].label).toBe("Derivó a una persona");
  });

  it("una accion nueva se muestra igual, sin guiones bajos", () => {
    expect(agentActionRows([{ action: "algo_nuevo", actions: 1, reverted: 0 }])[0].label).toBe("Algo nuevo");
  });
});
