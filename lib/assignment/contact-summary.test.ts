import { describe, expect, it } from "vitest";
import { automaticRulesFromAudit, summarizeContact } from "./contact-summary";

const now = new Date("2026-10-10T18:00:00Z");
const base = { now, timeZone: "America/Costa_Rica", setterName: "Ana", vendedorName: null, locked: false, automaticRule: {} };

describe("summarizeContact", () => {
  it("con toques muestra el último con fecha relativa", () => {
    const attribution = { version: 2, last_touch: { source: "instagram", medium: "paid_social", campaign: "octubre", occurred_at: "2026-10-07T15:00:00Z" } };
    expect(summarizeContact({ ...base, attribution }).touchLine).toBe("Instagram / anuncio / campaña octubre (hace 3 días)");
  });

  it("sin toques: 'Sin atribución'", () => {
    expect(summarizeContact({ ...base, attribution: null }).touchLine).toBe("Sin atribución");
  });

  it("asignación automática: el nombre de la regla", () => {
    const s = summarizeContact({ ...base, attribution: null, automaticRule: { setter: "Campañas de José" } });
    expect(s.assignmentLines[0].text).toBe("Setter: Ana (por la regla Campañas de José)");
    expect(s.assignmentLines[1].text).toBe("Vendedor: sin asignar");
  });

  it("a mano: 'asignado a mano', aunque antes hubiera una automática", () => {
    const s = summarizeContact({ ...base, attribution: null, locked: true, automaticRule: { setter: "Campañas de José" } });
    expect(s.assignmentLines[0].text).toBe("Setter: Ana (asignado a mano)");
  });

  it("sin dato de cómo se asignó, solo el nombre", () => {
    expect(summarizeContact({ ...base, attribution: null }).assignmentLines[0].text).toBe("Setter: Ana");
  });
});

describe("automaticRulesFromAudit", () => {
  it("toma la última asignación del sistema por tipo y descarta lo hecho por personas", () => {
    const rows = [
      { action: "assignment.automatic", actor_type: "system", actor_label: "Vieja", metadata: { kind: "setter" }, performed_at: "2026-10-01T00:00:00Z" },
      { action: "assignment.automatic", actor_type: "system", actor_label: "Nueva", metadata: { kind: "setter" }, performed_at: "2026-10-05T00:00:00Z" },
      { action: "assignment.automatic", actor_type: "system", actor_label: "Para vendedor", metadata: { kind: "vendedor" }, performed_at: "2026-10-03T00:00:00Z" },
      { action: "assign", actor_type: "user", actor_label: null, metadata: null, performed_at: "2026-10-09T00:00:00Z" },
      { action: "assignment.automatic", actor_type: "user", actor_label: "No cuenta", metadata: { kind: "vendedor" }, performed_at: "2026-10-09T00:00:00Z" },
    ];
    expect(automaticRulesFromAudit(rows)).toEqual({ setter: "Nueva", vendedor: "Para vendedor" });
  });
});
