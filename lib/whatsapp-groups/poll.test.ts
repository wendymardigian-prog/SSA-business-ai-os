import { describe, it, expect } from "vitest";
import { validatePoll } from "./poll";

describe("validatePoll", () => {
  it("una encuesta valida, sin opciones vacias", () => {
    expect(validatePoll({ question: " ¿Qué día? ", options: ["Lunes", "", " Martes "], multiple: false })).toEqual({
      ok: true,
      poll: { name: "¿Qué día?", values: ["Lunes", "Martes"], selectableCount: 1 },
    });
  });

  it("varias respuestas = selectableCount 0", () => {
    const r = validatePoll({ question: "X", options: ["a", "b"], multiple: true });
    expect(r.ok && r.poll.selectableCount).toBe(0);
  });

  it("sin pregunta, con una sola opcion, repetidas o demasiadas, no", () => {
    expect(validatePoll({ question: "", options: ["a", "b"], multiple: false }).ok).toBe(false);
    expect(validatePoll({ question: "X", options: ["a"], multiple: false }).ok).toBe(false);
    expect(validatePoll({ question: "X", options: ["Sí", "sí"], multiple: false })).toEqual({ ok: false, error: "La opción «sí» está repetida." });
    expect(validatePoll({ question: "X", options: Array.from({ length: 13 }, (_, i) => `o${i}`), multiple: false }).ok).toBe(false);
  });
});
