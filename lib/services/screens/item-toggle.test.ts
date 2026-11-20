import { describe, it, expect } from "vitest";
import { CLOSED_PHASE_UNCHECK_REASON, itemToggleState } from "./item-toggle";

const base = { canItems: true, phaseStatus: "in_progress", isDone: false, lock: null };

describe("itemToggleState", () => {
  it("un paso pendiente de una fase cerrada se puede tildar", () => {
    expect(itemToggleState({ ...base, phaseStatus: "completed" })).toEqual({ disabled: false, reason: null });
  });

  it("un paso completo de una fase cerrada no se destilda, y dice por qué", () => {
    expect(itemToggleState({ ...base, phaseStatus: "completed", isDone: true })).toEqual({ disabled: true, reason: CLOSED_PHASE_UNCHECK_REASON });
  });

  it("en una fase abierta se tilda y se destilda como siempre", () => {
    expect(itemToggleState(base).disabled).toBe(false);
    expect(itemToggleState({ ...base, isDone: true }).disabled).toBe(false);
    expect(itemToggleState({ ...base, phaseStatus: "pending" }).disabled).toBe(false);
  });

  it("con candado no se tilda (en cualquier fase), con el mensaje del candado", () => {
    const lock = { message: "Se abre el 20/11" };
    expect(itemToggleState({ ...base, lock })).toEqual({ disabled: true, reason: "Se abre el 20/11" });
    expect(itemToggleState({ ...base, phaseStatus: "completed", lock })).toEqual({ disabled: true, reason: "Se abre el 20/11" });
  });

  it("sin el permiso, nada", () => {
    expect(itemToggleState({ ...base, canItems: false }).disabled).toBe(true);
    expect(itemToggleState({ ...base, canItems: false, isDone: true }).disabled).toBe(true);
  });
});
