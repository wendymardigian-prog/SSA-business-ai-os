import { describe, expect, it } from "vitest";
import { decideVersionWrite } from "./autosave";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("C6 · decidir si la version se actualiza o se crea una nueva", () => {
  it("sin ninguna version todavia: inserta", () => {
    expect(decideVersionWrite({ last: null, authorId: "ana", now: NOW })).toBe("insert");
  });

  it("la ultima fue hace 8 minutos, mismo autor, reason edit: actualiza", () => {
    const last = { authorId: "ana", reason: "edit", updatedAt: minutesAgo(8) };
    expect(decideVersionWrite({ last, authorId: "ana", now: NOW })).toBe("update");
  });

  it("pasaron 10 minutos o mas: la sesion se corto, inserta", () => {
    const last = { authorId: "ana", reason: "edit", updatedAt: minutesAgo(10) };
    expect(decideVersionWrite({ last, authorId: "ana", now: NOW })).toBe("insert");
    expect(
      decideVersionWrite({ last: { ...last, updatedAt: minutesAgo(15) }, authorId: "ana", now: NOW }),
    ).toBe("insert");
  });

  it("la sesion es por autor: otra persona abre la suya aunque hayan pasado 2 minutos", () => {
    const last = { authorId: "ana", reason: "edit", updatedAt: minutesAgo(2) };
    expect(decideVersionWrite({ last, authorId: "sofia", now: NOW })).toBe("insert");
  });

  it("un evento que corto la sesion (status_change, approve, ai_generation, restore) siempre inserta despues", () => {
    for (const reason of ["status_change", "approve", "ai_generation", "restore", "manual_save"]) {
      const last = { authorId: "ana", reason, updatedAt: minutesAgo(1) };
      expect(decideVersionWrite({ last, authorId: "ana", now: NOW })).toBe("insert");
    }
  });

  it("una fecha invalida en la ultima version no rompe: inserta", () => {
    const last = { authorId: "ana", reason: "edit", updatedAt: "no-es-una-fecha" };
    expect(decideVersionWrite({ last, authorId: "ana", now: NOW })).toBe("insert");
  });
});
