import { describe, expect, it } from "vitest";
import { googleEditParts, googleEditSummary, type GoogleEditState } from "./edit-summary";

const TZ = "America/Costa_Rica";
const base: GoogleEditState = { summary: "Café", location: "", description: "", guests: ["ana@ejemplo.com"], startUtc: "2026-11-24T15:00:00.000Z", durationMinutes: 60 };

describe("qué cambia en tu Google", () => {
  it("sin cambios, nada", () => {
    expect(googleEditSummary(base, { ...base, guests: [" ANA@ejemplo.com "] }, TZ, "24h")).toEqual([]);
    expect(googleEditParts(base, base)).toEqual({ text: false, time: false, guests: false });
  });

  it("título, horario, invitados y descripción", () => {
    const after = { ...base, summary: "Café con Ana", startUtc: "2026-11-24T16:00:00.000Z", durationMinutes: 30, guests: ["bruno@ejemplo.com"], description: "nota" };
    expect(googleEditSummary(base, after, TZ, "24h")).toEqual([
      "Título: «Café» → «Café con Ana»",
      "Horario: Martes, 24 de noviembre · 09:00 a 10:00 → Martes, 24 de noviembre · 10:00 a 10:30",
      "Invitados que se suman: bruno@ejemplo.com",
      "Invitados que se sacan: ana@ejemplo.com",
      "Descripción: cambia",
    ]);
    expect(googleEditParts(base, after)).toEqual({ text: true, time: true, guests: true });
  });
});
