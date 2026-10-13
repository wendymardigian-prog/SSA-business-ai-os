import { describe, it, expect } from "vitest";
import { completionRoute, formatShiftLine, groupShiftsByChain, shiftSummary, type ChainShift } from "./shift-preview";

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
