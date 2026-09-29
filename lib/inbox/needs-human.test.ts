/**
 * El aviso de "necesita humano" en la bandeja (F11).
 */

import { describe, it, expect } from "vitest";
import { NEEDS_HUMAN_PARAM, countNeedsHuman, needsHumanBadge } from "./needs-human";

describe("needsHumanBadge (F11)", () => {
  it("una conversacion escalada muestra el badge con el motivo en el title", () => {
    expect(
      needsHumanBadge({
        needs_human: true,
        needs_human_reason: "Llegó una nota de voz que no se pudo transcribir",
      }),
    ).toEqual({
      show: true,
      label: "Necesita humano",
      title: "Llegó una nota de voz que no se pudo transcribir. El asistente no respondió: contestale vos.",
    });
  });

  it("escalada sin motivo igual explica que pasa: un badge rojo sin title es peor que nada", () => {
    const badge = needsHumanBadge({ needs_human: true, needs_human_reason: null });

    expect(badge.show).toBe(true);
    expect(badge.title).toContain("no respondió");
    expect(badge.title.length).toBeGreaterThan(0);
  });

  it("una conversacion normal no muestra nada", () => {
    expect(needsHumanBadge({ needs_human: false }).show).toBe(false);
    expect(needsHumanBadge({}).show).toBe(false);
    expect(needsHumanBadge(null).show).toBe(false);
    expect(needsHumanBadge(undefined).show).toBe(false);
  });

  it("siempre devuelve un objeto: el componente no decide nada", () => {
    const badge = needsHumanBadge(null);
    expect(badge.label).toBe("Necesita humano");
    expect(badge.title).toBe("");
  });
});

describe("countNeedsHuman (F11)", () => {
  it("cuenta las escaladas de lo que se esta mirando", () => {
    expect(
      countNeedsHuman([{ needs_human: true }, { needs_human: false }, { needs_human: true }, null, undefined, {}]),
    ).toBe(2);
  });

  it("una lista vacia es cero", () => {
    expect(countNeedsHuman([])).toBe(0);
  });
});

describe("el parametro de la URL", () => {
  it("es el mismo que lee la pagina y escribe el chip", () => {
    expect(NEEDS_HUMAN_PARAM).toBe("necesita-humano");
  });
});
