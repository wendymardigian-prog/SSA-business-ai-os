import { describe, expect, it } from "vitest";
import { activityEntries, activityText, badgeLabel, type CallAuditRow } from "./activity";

const row = (over: Partial<CallAuditRow>): CallAuditRow => ({
  id: "a1",
  action: "call.proposal_approved",
  performed_at: "2026-11-12T10:00:00Z",
  performed_by: "u1",
  changes: null,
  metadata: { type: "tarea" },
  ...over,
});
const names = { u1: "Ana" };

describe("activityText", () => {
  it("traduce cada acción a una frase", () => {
    expect(activityText(row({}), names)).toBe("Ana aprobó una tarea.");
    expect(activityText(row({ action: "call.proposal_discarded", metadata: { type: "mensaje" } }), names)).toBe("Ana descartó un mensaje para el cliente.");
    expect(activityText(row({ action: "call.proposal_edited", changes: { titulo: { old: "a", new: "b" }, vence_en_dias: { old: 1, new: 2 } } }), names)).toBe("Ana editó y aprobó una tarea (cambió el título, el vencimiento).");
    expect(activityText(row({ action: "call.proposal_failed", metadata: { type: "paso", reason: "Este paso pide evidencia." } }), names)).toBe("No se pudo hacer completar un paso: Este paso pide evidencia.");
    expect(activityText(row({ action: "call.manual_summary" }), names)).toBe("Ana cargó la reunión a mano.");
  });
  it("el vínculo con el servicio: a mano, desvinculada, por revisar y por el sistema", () => {
    expect(activityText(row({ action: "call.service_linked", changes: { service_id: { old: null, new: "s1" }, service_link: { old: null, new: "manual" } } }), names, { s1: "Mentoría · Anual" })).toBe("Ana la vinculó a Mentoría · Anual.");
    expect(activityText(row({ action: "call.service_linked", changes: { service_id: { old: "s1", new: null }, service_link: { old: "auto", new: "manual" } } }), names)).toBe("Ana la desvinculó del servicio.");
    expect(activityText(row({ action: "call.service_linked", performed_by: null, changes: { service_id: { old: null, new: null }, service_link: { old: null, new: "review" } } }), names)).toMatch(/^El sistema la dejó «Por revisar»/);
  });
  it("lo que no es de la Actividad no aparece", () => {
    expect(activityText(row({ action: "call.analyzed" }), names)).toBeNull();
  });
});

describe("activityEntries", () => {
  it("ordena por fecha", () => {
    const out = activityEntries([row({ id: "b", performed_at: "2026-11-12T11:00:00Z" }), row({ id: "a", performed_at: "2026-11-12T09:00:00Z" }), row({ id: "x", action: "call.analyzed" })], names);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("badgeLabel", () => {
  it("nada en 0, el número hasta 9 y «9+» desde 10", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(10)).toBe("9+");
  });
});
