import { describe, it, expect } from "vitest";
import { countActiveActionFilters, describeChanges, parseActionFilters } from "./actions-query";

const known = { currentAgentId: "agent-1", agentIds: ["agent-1"], channelIds: ["ch-1"] };

describe("parseActionFilters", () => {
  it("valores inventados se ignoran; el agente de la pestana es el default", () => {
    const f = parseActionFilters({ accion: "borrar", canal: "ch-9", revertida: "quizas", agente: "x", contacto: "nope" }, known);
    expect(f).toMatchObject({ page: 1, accion: "", canal: "", revertida: "", agente: "agent-1", contacto: "" });
    expect(countActiveActionFilters(f, "agent-1")).toBe(0);
  });

  it("los validos pasan y se cuentan", () => {
    const f = parseActionFilters({ accion: "tag", canal: "ch-1", revertida: "si", agente: "todos", fecha: "30d", page: "2" }, known);
    expect(f).toMatchObject({ accion: "tag", canal: "ch-1", revertida: "si", agente: "todos", datePreset: "30d", page: 2 });
    expect(countActiveActionFilters(f, "agent-1")).toBe(5);
  });
});

describe("describeChanges", () => {
  const entry = (action: string, changes: unknown) => ({
    id: "a",
    entity_type: "contact",
    entity_id: "c",
    action,
    changes: changes as never,
    metadata: null,
    performed_by_agent_id: "agent-1",
    performed_at: "2026-09-24T12:00:00Z",
    reverted_at: null,
    reverted_by_audit_id: null,
  });
  const tags = new Map([["t-1", "Interesado"]]);
  const members = new Map([["u-1", "Wendy"]]);

  it("traduce ids de tags y de miembros a nombres, y los valores a palabras", () => {
    expect(describeChanges(entry("tag", { tags: { old: null, new: "t-1,t-x" } }), tags, members)).toEqual([
      { field: "Etiquetas", before: "vacío", after: "Interesado, etiqueta borrada" },
    ]);
    expect(describeChanges(entry("assign", { assigned_to: { old: null, new: "u-1" } }), tags, members)).toEqual([{ field: "Asignada a", before: "vacío", after: "Wendy" }]);
    expect(describeChanges(entry("temperature", { lead_temperature: { old: "cold", new: "hot" } }), tags, members)).toEqual([{ field: "Temperatura", before: "frío", after: "caliente" }]);
    expect(describeChanges(entry("human_takeover", { agent_enabled: { old: null, new: false } }), tags, members)).toEqual([
      { field: "Agente en la conversación", before: "hereda del canal", after: "apagado" },
    ]);
  });
});
