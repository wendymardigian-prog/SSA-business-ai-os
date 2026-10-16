import { describe, expect, it } from "vitest";
import { planHeaderActions, type HeaderInput } from "@/lib/inbox/header-actions";

const base: HeaderInput = { status: "open", canCreateTask: true, isAutomationPaused: false, agentDisabledByTag: false, draftMode: false };

describe("cabecera de la conversacion", () => {
  it("abierta: cerrar a la vista; posponer y crear tarea en el menu", () => {
    const plan = planHeaderActions(base);
    expect(plan.primary).toBe("close");
    expect(plan.menu).toEqual(["snooze", "createTask"]);
    expect(plan.notes).toEqual(["status"]);
    expect(plan.hasAlert).toBe(false);
  });

  it("cerrada: reabrir a la vista, y se puede posponer", () => {
    const plan = planHeaderActions({ ...base, status: "closed" });
    expect(plan.primary).toBe("reopen");
    expect(plan.menu).toEqual(["snooze", "createTask"]);
  });

  it("pospuesta: cerrar a la vista y reabrir en el menu, sin posponer de nuevo", () => {
    const plan = planHeaderActions({ ...base, status: "snoozed" });
    expect(plan.primary).toBe("close");
    expect(plan.menu).toEqual(["reopen", "createTask"]);
  });

  it("sin permiso para crear tareas no aparece esa fila", () => {
    expect(planHeaderActions({ ...base, canCreateTask: false }).menu).toEqual(["snooze"]);
  });

  it("los avisos pasan a filas de texto y prenden el punto del boton", () => {
    const plan = planHeaderActions({ ...base, isAutomationPaused: true, agentDisabledByTag: true, draftMode: true });
    expect(plan.notes).toEqual(["status", "flowsPaused", "agentOffByTag", "draftMode"]);
    expect(plan.hasAlert).toBe(true);
  });

  it("el estado solo no cuenta como aviso", () => {
    expect(planHeaderActions(base).hasAlert).toBe(false);
  });

  it("toda accion de estado queda alcanzable desde alguna parte, en cualquier estado", () => {
    for (const status of ["open", "snoozed", "closed"] as const) {
      const plan = planHeaderActions({ ...base, status });
      const reachable = new Set<string>([plan.primary === "close" ? "close" : "reopen", ...plan.menu]);
      if (status !== "closed") expect(reachable.has("close")).toBe(true);
      if (status !== "open") expect(reachable.has("reopen")).toBe(true);
      if (status !== "snoozed") expect(reachable.has("snooze")).toBe(true);
    }
  });
});
