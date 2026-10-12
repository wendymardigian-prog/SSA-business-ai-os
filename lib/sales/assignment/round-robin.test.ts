import { describe, expect, it } from "vitest";
import { lastIndexOf, pickRoundRobin } from "./round-robin";

const all = new Set(["a", "b", "c"]);

describe("pickRoundRobin", () => {
  it("el siguiente después del último, dando la vuelta", () => {
    expect(pickRoundRobin(["a", "b", "c"], 2, all)).toEqual({ memberId: "a", nextIndex: 0 });
    expect(pickRoundRobin(["a", "b", "c"], 0, all)).toEqual({ memberId: "b", nextIndex: 1 });
  });

  it("saltea al inactivo sin correr el puntero (el original lo corría con el módulo)", () => {
    expect(pickRoundRobin(["a", "b", "c"], 0, new Set(["a", "c"]))).toEqual({ memberId: "c", nextIndex: 2 });
  });

  it("sin último (nunca se asignó) empieza por el primero", () => {
    expect(pickRoundRobin(["a", "b", "c"], null, all)).toEqual({ memberId: "a", nextIndex: 0 });
    expect(pickRoundRobin(["a", "b", "c"], -1, all)).toEqual({ memberId: "a", nextIndex: 0 });
  });

  it("vacío o todos inactivos → null", () => {
    expect(pickRoundRobin([], 0, all)).toBeNull();
    expect(pickRoundRobin(["a", "b"], 0, new Set())).toBeNull();
  });

  it("un solo activo recibe a todos", () => {
    expect(pickRoundRobin(["a", "b", "c"], 1, new Set(["b"]))).toEqual({ memberId: "b", nextIndex: 1 });
  });

  it("un índice fuera de rango no rompe", () => {
    expect(pickRoundRobin(["a", "b"], 99, new Set(["a", "b"]))?.memberId).toBeDefined();
  });
});

describe("lastIndexOf", () => {
  it("-1 si nunca se asignó o ya no está", () => {
    expect(lastIndexOf(["a", "b"], null)).toBe(-1);
    expect(lastIndexOf(["a", "b"], "z")).toBe(-1);
    expect(lastIndexOf(["a", "b"], "b")).toBe(1);
  });
});
