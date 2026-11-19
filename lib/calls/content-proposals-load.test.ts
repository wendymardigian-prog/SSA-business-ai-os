import { describe, expect, it } from "vitest";
import { pendingContentFromCalls } from "./content-proposals-load";

const p = (id: string, type: string, status: string, titulo: string) => ({ id, type, status, original: { titulo, detalle: "" }, edited: null, result: null });

describe("las propuestas de contenido que esperan en las grabaciones", () => {
  it("solo idea y borrador pendientes; la grabación más nueva primero", () => {
    const out = pendingContentFromCalls([
      { id: "c1", title: "Vieja", recorded_at: "2026-11-01T10:00:00Z", proposals: [p("a", "idea", "pending", "Idea A"), p("b", "tarea", "pending", "Tarea")] },
      { id: "c2", title: "Nueva", recorded_at: "2026-11-05T10:00:00Z", proposals: [p("c", "borrador", "pending", "Borrador C"), p("d", "idea", "done", "Ya aprobada")] },
      { id: "c3", title: "Sin nada", recorded_at: "2026-11-06T10:00:00Z", proposals: [p("e", "idea", "discarded", "Descartada")] },
    ]);
    expect(out).toEqual([
      { callId: "c2", callTitle: "Nueva", recordedAt: "2026-11-05T10:00:00Z", items: [{ id: "c", typeLabel: "Borrador de contenido", title: "Borrador C" }] },
      { callId: "c1", callTitle: "Vieja", recordedAt: "2026-11-01T10:00:00Z", items: [{ id: "a", typeLabel: "Idea de contenido", title: "Idea A" }] },
    ]);
  });
});
