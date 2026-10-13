import { describe, it, expect } from "vitest";
import { computeDateShifts, type DateRuleTask } from "./date-rules";

function task(id: string, due: string | null, blockedBy: Array<[string, number]> = [], extra: Partial<DateRuleTask> = {}): DateRuleTask {
  return {
    id,
    status: "pending",
    due_date: due,
    start_date: null,
    blocked_by: blockedBy.map(([task_id, gap_days]) => ({ task_id, gap_days })),
    ...extra,
  };
}

describe("computeDateShifts (F3)", () => {
  it("1. A (vence hoy) completada hoy: B (manana, gap 1) no se mueve", () => {
    const tasks = [task("A", "2026-10-13"), task("B", "2026-10-14", [["A", 1]])];
    expect(computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" }).shifts).toEqual([]);
  });

  it("2. A (10) completada el 13: B (11, gap 1) pasa al 14", () => {
    const tasks = [task("A", "2026-10-10"), task("B", "2026-10-11", [["A", 1]])];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" });
    expect(shifts).toEqual([
      { taskId: "B", fromDue: "2026-10-11", toDue: "2026-10-14", fromStart: null, toStart: null, days: 3, blockerId: "A" },
    ]);
  });

  it("3. completada ANTES del vencimiento: no se adelanta nada", () => {
    const tasks = [task("A", "2026-10-20"), task("B", "2026-10-21", [["A", 1]])];
    expect(computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-15" }).shifts).toEqual([]);
  });

  it("4. cadena A -> B -> C: se corren los dos, en orden topologico", () => {
    const tasks = [
      task("A", "2026-10-10"),
      task("B", "2026-10-11", [["A", 1]]),
      task("C", "2026-10-12", [["B", 1]]),
    ];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" });
    expect(shifts.map((s) => [s.taskId, s.toDue])).toEqual([
      ["B", "2026-10-14"],
      ["C", "2026-10-15"],
    ]);
    expect(shifts[1].blockerId).toBe("B");
  });

  it("5. dos bloqueantes: manda el mayor (basis + gap); el que no esta completo usa su vencimiento", () => {
    const tasks = [
      task("A1", "2026-10-10"),
      task("A2", "2026-10-20"),
      task("B", "2026-10-12", [["A1", 1], ["A2", 2]]),
    ];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A1", completedOn: "2026-10-13" });
    // A1: 13 + 1 = 14; A2 (abierta): 20 + 2 = 22 -> manda A2.
    expect(shifts).toEqual([
      { taskId: "B", fromDue: "2026-10-12", toDue: "2026-10-22", fromStart: null, toStart: null, days: 10, blockerId: "A2" },
    ]);
  });

  it("5b. el otro bloqueante ya completado usa su fecha real de completado", () => {
    const tasks = [
      task("A1", "2026-10-10"),
      task("A2", "2026-10-01", [], { status: "completed", completed_on: "2026-10-30" }),
      task("B", "2026-10-12", [["A1", 1], ["A2", 0]]),
    ];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A1", completedOn: "2026-10-13" });
    expect(shifts.map((s) => [s.taskId, s.toDue, s.blockerId])).toEqual([["B", "2026-10-30", "A2"]]);
  });

  it("6. un dependiente completado o sin vencimiento no participa", () => {
    const tasks = [
      task("A", "2026-10-10"),
      task("B", "2026-10-11", [["A", 1]], { status: "completed" }),
      task("C", null, [["A", 1]]),
    ];
    expect(computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" }).shifts).toEqual([]);
  });

  it("7. un bloqueante sin fecha y sin completar se ignora", () => {
    const tasks = [
      task("A", "2026-10-10"),
      task("X", null),
      task("B", "2026-10-11", [["A", 1], ["X", 5]]),
    ];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" });
    expect(shifts.map((s) => [s.taskId, s.toDue, s.blockerId])).toEqual([["B", "2026-10-14", "A"]]);
  });

  it("8. start_date se corre los mismos dias; sin start_date queda null", () => {
    const tasks = [
      task("A", "2026-10-10"),
      task("B", "2026-10-15", [["A", 1]], { start_date: "2026-10-12" }),
      task("C", "2026-10-11", [["A", 1]]),
    ];
    const { shifts } = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-20" });
    const b = shifts.find((s) => s.taskId === "B");
    const c = shifts.find((s) => s.taskId === "C");
    expect(b).toMatchObject({ days: 6, fromStart: "2026-10-12", toStart: "2026-10-18", toDue: "2026-10-21" });
    expect(c?.toStart).toBeNull();
  });

  it("9. cambio de mes, de ano y bisiesto: 2028-02-28 + 1 = 2028-02-29", () => {
    const leap = [task("A", "2028-02-20"), task("B", "2028-02-21", [["A", 1]])];
    expect(computeDateShifts({ tasks: leap, completedTaskId: "A", completedOn: "2028-02-28" }).shifts[0].toDue).toBe("2028-02-29");
    const year = [task("A", "2026-12-20"), task("B", "2026-12-21", [["A", 2]])];
    expect(computeDateShifts({ tasks: year, completedTaskId: "A", completedOn: "2026-12-30" }).shifts[0].toDue).toBe("2027-01-01");
    const nonLeap = [task("A", "2027-02-20"), task("B", "2027-02-21", [["A", 1]])];
    expect(computeDateShifts({ tasks: nonLeap, completedTaskId: "A", completedOn: "2027-02-28" }).shifts[0].toDue).toBe("2027-03-01");
  });

  it("10. es determinista y no muta su entrada", () => {
    const tasks = [task("A", "2026-10-10"), task("B", "2026-10-11", [["A", 1]], { start_date: "2026-10-09" })];
    const snapshot = JSON.parse(JSON.stringify(tasks));
    const first = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" });
    const second = computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" });
    expect(second).toEqual(first);
    expect(tasks).toEqual(snapshot);
  });

  it("una tarea completada que no esta en la lista, o sin dependientes, da un plan vacio", () => {
    expect(computeDateShifts({ tasks: [], completedTaskId: "Z", completedOn: "2026-10-13" }).shifts).toEqual([]);
    expect(computeDateShifts({ tasks: [task("A", "2026-10-10")], completedTaskId: "A", completedOn: "2026-10-13" }).shifts).toEqual([]);
  });

  it("un ciclo en los datos no cuelga ni devuelve basura", () => {
    const tasks = [task("A", "2026-10-10"), task("B", "2026-10-11", [["A", 1], ["C", 1]]), task("C", "2026-10-12", [["B", 1]])];
    expect(() => computeDateShifts({ tasks, completedTaskId: "A", completedOn: "2026-10-13" })).not.toThrow();
  });
});
