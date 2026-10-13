import { describe, it, expect } from "vitest";
import { makeTask, taskId } from "./fixtures";
import { computePosition, dropIndex, groupByStatus, planMove, POSITION_STEP } from "./kanban-model";

const t = (n: number, over: Partial<ReturnType<typeof makeTask>> = {}) => makeTask({ id: taskId(n), title: `T${n}`, created_at: `2026-10-0${n}T10:00:00Z`, ...over });

describe("groupByStatus (F16)", () => {
  it("tres columnas por estado, ordenadas por posicion y, si empatan, por antiguedad", () => {
    const cols = groupByStatus([
      t(1, { status: "pending", position: 3000 }),
      t(2, { status: "pending", position: 1000 }),
      t(3, { status: "pending", position: 1000 }),
      t(4, { status: "in_progress" }),
      t(5, { status: "completed" }),
    ]);
    expect(cols.pending.map((x) => x.title)).toEqual(["T2", "T3", "T1"]);
    expect(cols.in_progress).toHaveLength(1);
    expect(cols.completed).toHaveLength(1);
  });
  it("sin tareas: tres columnas vacias", () => {
    expect(groupByStatus([])).toEqual({ pending: [], in_progress: [], completed: [] });
  });
  it("no muta la entrada", () => {
    const input = [t(1, { position: 2 }), t(2, { position: 1 })];
    const copy = [...input];
    groupByStatus(input);
    expect(input).toEqual(copy);
  });
});

describe("computePosition", () => {
  it("columna vacia", () => expect(computePosition(null, null)).toBe(POSITION_STEP));
  it("al inicio", () => expect(computePosition(null, 1000)).toBe(0));
  it("al final", () => expect(computePosition(3000, null)).toBe(4000));
  it("en el medio: el promedio, con fracciones", () => {
    expect(computePosition(1000, 2000)).toBe(1500);
    expect(computePosition(1000, 1001)).toBe(1000.5);
  });
});

describe("planMove (F16)", () => {
  const cols = () =>
    groupByStatus([
      t(1, { status: "pending", position: 1000 }),
      t(2, { status: "pending", position: 2000 }),
      t(3, { status: "pending", position: 3000 }),
      t(4, { status: "in_progress", position: 1000 }),
    ]);

  it("reordenar dentro de la columna: solo cambia la tarjeta movida", () => {
    const plan = planMove(cols(), taskId(3), "pending", 0);
    expect(plan).toEqual({ status: "pending", changesStatus: false, updates: [{ id: taskId(3), position: 0 }] });
  });
  it("al medio de otra columna cambia el estado y la posicion", () => {
    const plan = planMove(cols(), taskId(1), "in_progress", 1);
    expect(plan).toEqual({ status: "in_progress", changesStatus: true, updates: [{ id: taskId(1), position: 2000 }] });
  });
  it("a una columna vacia", () => {
    expect(planMove(cols(), taskId(1), "completed", 0)).toEqual({ status: "completed", changesStatus: true, updates: [{ id: taskId(1), position: POSITION_STEP }] });
  });
  it("al final de la propia columna", () => {
    expect(planMove(cols(), taskId(1), "pending", 2)).toEqual({ status: "pending", changesStatus: false, updates: [{ id: taskId(1), position: 4000 }] });
  });
  it("soltarla donde ya estaba no cambia nada", () => {
    expect(planMove(cols(), taskId(2), "pending", 1)).toBeNull();
  });
  it("una tarea que no esta en el tablero, nada", () => {
    expect(planMove(cols(), "no-existe", "pending", 0)).toBeNull();
  });
  it("el indice se acota al largo de la columna", () => {
    expect(planMove(cols(), taskId(1), "in_progress", 99)?.updates[0].position).toBe(2000);
    expect(planMove(cols(), taskId(1), "in_progress", -5)?.updates[0].position).toBe(0);
  });
  it("vecinas con la misma posicion (tareas recien creadas, todas en 0): renumera la columna de destino", () => {
    const c = groupByStatus([t(1, { status: "pending" }), t(2, { status: "pending" }), t(3, { status: "pending" }), t(4, { status: "in_progress" })]);
    const plan = planMove(c, taskId(4), "pending", 1);
    expect(plan?.changesStatus).toBe(true);
    // Orden final: T1, T4, T2, T3 -> 1000, 2000, 3000, 4000.
    const byId = Object.fromEntries((plan?.updates ?? []).map((u) => [u.id, u.position]));
    expect(byId[taskId(4)]).toBe(2000);
    expect(byId[taskId(1)]).toBe(1000);
    expect(byId[taskId(2)]).toBe(3000);
    expect(byId[taskId(3)]).toBe(4000);
  });
  it("sin espacio entre dos vecinas (la mitad cae encima): renumera", () => {
    const c = groupByStatus([t(1, { status: "pending", position: 1 }), t(2, { status: "pending", position: 1 + Number.EPSILON }), t(3, { status: "in_progress" })]);
    const plan = planMove(c, taskId(3), "pending", 1);
    expect(plan && plan.updates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("dropIndex", () => {
  it("segun la altura del puntero entre los centros de las tarjetas", () => {
    expect(dropIndex([], 100)).toBe(0);
    expect(dropIndex([50, 150, 250], 10)).toBe(0);
    expect(dropIndex([50, 150, 250], 100)).toBe(1);
    expect(dropIndex([50, 150, 250], 200)).toBe(2);
    expect(dropIndex([50, 150, 250], 999)).toBe(3);
  });
});
