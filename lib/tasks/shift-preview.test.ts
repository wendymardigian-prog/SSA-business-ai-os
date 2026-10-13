import { describe, it, expect } from "vitest";
import { completionRoute, formatShiftLine, groupShiftsByChain, hiddenShiftsLine, shiftSummary, visibleChains, type ChainShift } from "./shift-preview";

const s = (taskId: string, blockerId: string, blockerTitle: string, days = 3): ChainShift => ({
  taskId, blockerId, blockerTitle, title: `Tarea ${taskId}`, fromDue: "2026-10-11", toDue: "2026-10-14", days,
});

describe("vista previa de fechas (F13)", () => {
  it("formatShiftLine con pluralizacion", () => {
    expect(formatShiftLine({ title: "Contrato", fromDue: "2026-10-11", toDue: "2026-10-14", days: 3 })).toBe("Contrato — 11/10/2026 → 14/10/2026 (+3 días)");
    expect(formatShiftLine({ title: "Contrato", fromDue: "2026-10-11", toDue: "2026-10-12", days: 1 })).toBe("Contrato — 11/10/2026 → 12/10/2026 (+1 día)");
  });
  it("agrupa por cadena: lo que cuelga de un movido queda en su grupo, en orden", () => {
    const chains = groupShiftsByChain([s("B", "A", "A"), s("C", "B", "B"), s("X", "Z", "Z")]);
    expect(chains).toHaveLength(2);
    expect(chains[0].startTitle).toBe("A");
    expect(chains[0].shifts.map((x) => x.taskId)).toEqual(["B", "C"]);
    expect(chains[1].startTitle).toBe("Z");
    expect(chains[1].shifts.map((x) => x.taskId)).toEqual(["X"]);
  });
  it("sin corrimientos, ninguna cadena", () => {
    expect(groupShiftsByChain([])).toEqual([]);
  });
  it("un ciclo en los datos no cuelga", () => {
    expect(() => groupShiftsByChain([s("B", "C", "C"), s("C", "B", "B")])).not.toThrow();
  });
  it("plan vacio: se completa directo; con plan, se pregunta", () => {
    expect(completionRoute(0)).toBe("direct");
    expect(completionRoute(2)).toBe("dialog");
  });
  it("el resumen del titulo", () => {
    expect(shiftSummary(1)).toBe("Esto mueve la fecha de 1 tarea");
    expect(shiftSummary(3)).toBe("Esto mueve las fechas de 3 tareas");
  });
});

describe("tareas de otras personas en la vista previa (R10)", () => {
  const v = (taskId: string, blockerId: string, blockerTitle: string, visible: boolean): ChainShift & { visible: boolean } => ({ ...s(taskId, blockerId, blockerTitle), visible, title: visible ? `Tarea ${taskId}` : "" });

  it("la linea de las que no se ven: solo la cuenta, con singular y plural", () => {
    expect(hiddenShiftsLine(1)).toBe("Y 1 tarea de otra persona también se va a mover.");
    expect(hiddenShiftsLine(3)).toBe("Y 3 tareas de otras personas también se van a mover.");
  });
  it("las cadenas muestran solo las que se ven y cuentan las otras", () => {
    const { chains, hidden } = visibleChains([v("B", "A", "A", true), v("C", "B", "B", false), v("D", "C", "", true)]);
    expect(hidden).toBe(1);
    expect(chains).toHaveLength(1);
    expect(chains[0].shifts.map((x) => x.taskId)).toEqual(["B", "D"]);
    expect(JSON.stringify(chains)).not.toContain('"title":""');
  });
  it("una cadena sin ninguna visible desaparece", () => {
    const { chains, hidden } = visibleChains([v("X", "Z", "", false)]);
    expect(chains).toEqual([]);
    expect(hidden).toBe(1);
  });
});
