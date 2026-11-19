import { describe, expect, it } from "vitest";
import { editRatio, examplesText, pickExamples, type OutcomeForExamples } from "./examples";

const o = (over: Partial<OutcomeForExamples>): OutcomeForExamples => ({
  outcome: "approved",
  proposedText: "Hola, te cuento cómo funciona el servicio.",
  finalText: "Hola, te cuento cómo funciona el servicio.",
  decidedAt: "2026-11-10T10:00:00.000Z",
  channelId: "ch-1",
  kind: "message",
  ...over,
});

describe("ejemplos automáticos en el prompt", () => {
  it("toma los últimos aprobados del mismo canal y tipo, y nunca un rechazo", () => {
    const picked = pickExamples(
      [
        o({ proposedText: "viejo", decidedAt: "2026-11-01T00:00:00Z" }),
        o({ proposedText: "nuevo", decidedAt: "2026-11-12T00:00:00Z" }),
        o({ proposedText: "otro canal", channelId: "ch-2", decidedAt: "2026-11-13T00:00:00Z" }),
        o({ proposedText: "rechazado", outcome: "rejected", decidedAt: "2026-11-13T00:00:00Z" }),
        o({ proposedText: "otro tipo", kind: "crear_tarea", decidedAt: "2026-11-13T00:00:00Z" }),
      ],
      { channelId: "ch-1", kind: "message", approved: 1, edits: 0 },
    );
    expect(picked.approved).toEqual(["nuevo"]);
  });

  it("las ediciones más instructivas: ni cambios mínimos ni reescrituras enteras", () => {
    const minimal = o({ outcome: "approved_edited", proposedText: "Hola Ana, te escribo para contarte la novedad de hoy", finalText: "Hola Ana, te escribo para contarte la novedad de hoy." });
    const good = o({ outcome: "approved_edited", proposedText: "Hola Ana, te escribo para contarte todo sobre el servicio y sus condiciones generales", finalText: "Hola Ana, te escribo para contarte el precio del servicio" });
    const rewrite = o({ outcome: "approved_edited", proposedText: "uno dos tres", finalText: "cuatro cinco seis siete" });
    const picked = pickExamples([minimal, good, rewrite], { channelId: "ch-1", kind: "message", approved: 0, edits: 5 });
    expect(picked.edits).toHaveLength(1);
    expect(picked.edits[0].final).toBe("Hola Ana, te escribo para contarte el precio del servicio");
  });

  it("el texto de los ejemplos: vacío si no hay nada; «propuesto → final» en las ediciones", () => {
    expect(examplesText({ approved: [], edits: [] })).toBe("");
    const text = examplesText({ approved: ["A"], edits: [{ proposed: "B", final: "C" }] });
    expect(text).toContain("aprobó tal cual");
    expect(text).toContain("«B» → «C»");
  });

  it("la proporción de cambio", () => {
    expect(editRatio("a b c", "a b c")).toBe(0);
    expect(editRatio("a b", "c d")).toBe(1);
    expect(editRatio("", "")).toBe(0);
  });
});
