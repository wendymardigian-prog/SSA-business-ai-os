import { describe, it, expect } from "vitest";
import {
  MAX_STEP_ATTEMPTS,
  attemptsExhausted,
  computeNextStepAt,
  nextAttemptAt,
  parseSteps,
  stepVariables,
} from "./steps";
import type { SequenceStep } from "@/lib/types/database";

const NOW = new Date("2026-09-09T12:00:00.000Z");

describe("parseSteps", () => {
  it("devuelve una lista vacia si el jsonb trae cualquier otra cosa", () => {
    expect(parseSteps(null)).toEqual([]);
    expect(parseSteps({ type: "message" })).toEqual([]);
  });
});

describe("computeNextStepAt", () => {
  const steps: SequenceStep[] = [
    { type: "message", content: "hola" },
    { type: "delay", delayMinutes: 90 },
    { type: "aiMessage", prompt: "escribile" },
  ];

  it("espera lo que dice el paso de espera", () => {
    expect(computeNextStepAt(steps, 1, NOW)).toBe("2026-09-09T13:30:00.000Z");
  });

  it("un paso que manda se ejecuta en el tick siguiente, no espera", () => {
    expect(computeNextStepAt(steps, 2, NOW)).toBe(NOW.toISOString());
  });

  it("devuelve null cuando ya no hay mas pasos: la inscripcion se completa", () => {
    expect(computeNextStepAt(steps, 3, NOW)).toBeNull();
  });

  it("una espera de cero no frena nada: se trata como un paso inmediato", () => {
    expect(computeNextStepAt([{ type: "delay", delayMinutes: 0 }], 0, NOW)).toBe(
      NOW.toISOString()
    );
  });
});

describe("reintentos", () => {
  it("la espera crece entre intentos", () => {
    const first = new Date(nextAttemptAt(1, NOW)).getTime();
    const second = new Date(nextAttemptAt(2, NOW)).getTime();
    const third = new Date(nextAttemptAt(3, NOW)).getTime();
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("mas alla del ultimo tramo no se cae: repite el ultimo", () => {
    expect(nextAttemptAt(99, NOW)).toBe(nextAttemptAt(MAX_STEP_ATTEMPTS, NOW));
  });

  it("se agotan recien en el intento numero MAX_STEP_ATTEMPTS", () => {
    expect(attemptsExhausted(MAX_STEP_ATTEMPTS - 1)).toBe(false);
    expect(attemptsExhausted(MAX_STEP_ATTEMPTS)).toBe(true);
  });
});

describe("stepVariables", () => {
  it("first_name es la primera palabra del nombre: un mensaje dice 'Hola Ana', no 'Hola Ana Perez'", () => {
    const vars = stepVariables({ display_name: "Ana Perez" }) as {
      contact: { first_name: string; display_name: string };
    };
    expect(vars.contact.first_name).toBe("Ana");
    expect(vars.contact.display_name).toBe("Ana Perez");
  });

  it("un nombre de una sola palabra devuelve esa palabra", () => {
    const vars = stepVariables({ display_name: "Ana" }) as { contact: { first_name: string } };
    expect(vars.contact.first_name).toBe("Ana");
  });

  it("un campo faltante queda vacio, no como 'null' escrito en el mensaje", () => {
    const vars = stepVariables({ display_name: null }) as {
      contact: { display_name: string; first_name: string; email: string };
    };
    expect(vars.contact.display_name).toBe("");
    expect(vars.contact.first_name).toBe("");
    expect(vars.contact.email).toBe("");
  });
});
