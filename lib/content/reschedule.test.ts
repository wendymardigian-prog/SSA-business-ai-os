import { describe, it, expect } from "vitest";
import { plannedDateChanges } from "./reschedule";

const NOW = new Date("2026-09-26T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60000).toISOString();

const scheduled = (at: string) => [
  { platform: "instagram", status: "scheduled" as const, scheduledAt: at },
];

describe("A5 · cambiar la fecha de una red programada", () => {
  it("una fecha nueva se reprograma", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: inMinutes(120) }],
      scheduled(inMinutes(60)),
      NOW,
    );

    expect(result).toEqual([{ platform: "instagram", kind: "reschedule", at: inMinutes(120) }]);
  });

  it("la misma fecha no toca nada", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: inMinutes(60) }],
      scheduled(inMinutes(60)),
      NOW,
    );

    expect(result).toEqual([]);
  });

  it("una red que nunca se programo no se toca: su fecha es tentativa", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: inMinutes(120) }],
      [],
      NOW,
    );

    expect(result).toEqual([]);
  });

  it("una red ya publicada no se mueve", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: inMinutes(120) }],
      [{ platform: "instagram", status: "published", scheduledAt: inMinutes(-60) }],
      NOW,
    );

    expect(result).toEqual([]);
  });

  it("una fecha sin margen se saltea con el motivo", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: inMinutes(2) }],
      scheduled(inMinutes(60)),
      NOW,
    );

    expect(result).toEqual([
      { platform: "instagram", kind: "skip", reason: expect.stringContaining("Falta muy poco") },
    ]);
  });

  it("borrar la fecha no desprograma sola", () => {
    const result = plannedDateChanges(
      [{ platform: "instagram", plannedAt: null }],
      scheduled(inMinutes(60)),
      NOW,
    );

    expect(result).toEqual([
      { platform: "instagram", kind: "skip", reason: expect.stringContaining("Desprogramar") },
    ]);
  });
});
