import { describe, it, expect } from "vitest";
import { applyOptimistic, cellKeyAction, neighborCell, rollback, upsertRow, validateCellChange } from "./cell-edit";
import { makeTask, taskId } from "./fixtures";

const A = makeTask({ id: taskId(1), title: "A", owner_id: "u1", follower_ids: ["u2"], due_date: "2026-10-20" });
const B = makeTask({ id: taskId(2), title: "B", blocked_by: [{ task_id: taskId(1), gap_days: 1 }], due_date: "2026-10-25" });

describe("aplicar y deshacer (F11)", () => {
  it("aplica el cambio, devuelve la fila anterior y no muta la lista", () => {
    const list = [A, B];
    const { next, previous } = applyOptimistic(list, A.id, { priority: "urgent", due_date: "2026-11-01" });
    expect(next[0]).toMatchObject({ priority: "urgent", due_date: "2026-11-01" });
    expect(previous).toBe(A);
    expect(list[0]).toBe(A);
    expect(next[1]).toBe(B);
  });
  it("rollback devuelve la fila a como estaba", () => {
    const { next, previous } = applyOptimistic([A, B], A.id, { title: "cambio" });
    expect(rollback(next, previous!)[0]).toBe(A);
  });
  it("rollback de una fila que ya no esta no rompe", () => {
    expect(rollback([B], A)).toEqual([B]);
  });
  it("una tarea inexistente no cambia nada", () => {
    const { next, previous } = applyOptimistic([A], "nada", { title: "x" });
    expect(previous).toBeNull();
    expect(next).toEqual([A]);
  });
  it("el responsable se saca de los seguidores", () => {
    const { next } = applyOptimistic([A], A.id, { owner_id: "u2" });
    expect(next[0].owner_id).toBe("u2");
    expect(next[0].follower_ids).toEqual([]);
  });
  it("el proyecto se normaliza y se puede vaciar", () => {
    expect(applyOptimistic([A], A.id, { project: " Lanzamiento  Q4 " }).next[0]).toMatchObject({ project: "Lanzamiento Q4", project_key: "lanzamiento q4" });
    expect(applyOptimistic([A], A.id, { project: "" }).next[0]).toMatchObject({ project: null, project_key: null });
  });
  it("reabrir limpia completed_at", () => {
    const done = makeTask({ id: taskId(3), status: "completed", completed_at: "2026-10-05T00:00:00Z" });
    expect(applyOptimistic([done], done.id, { status: "pending" }).next[0].completed_at).toBeNull();
  });
  it("upsertRow reemplaza o agrega", () => {
    expect(upsertRow([A, B], { ...A, title: "nuevo" })[0].title).toBe("nuevo");
    expect(upsertRow([A], B)).toHaveLength(2);
  });
});

describe("validar antes de molestar al servidor (F11)", () => {
  const byId = new Map([[A.id, A], [B.id, B]]);
  it("titulo vacio o largo", () => {
    expect(validateCellChange(A, { title: "   " }, byId)).toMatch(/vacío/);
    expect(validateCellChange(A, { title: "x".repeat(201) }, byId)).toMatch(/200/);
    expect(validateCellChange(A, { title: "ok" }, byId)).toBeNull();
  });
  it("una tarea bloqueada no puede vencer antes que su bloqueante", () => {
    expect(validateCellChange(B, { due_date: "2026-10-19" }, byId)).toMatch(/antes que la que la bloquea/);
    expect(validateCellChange(B, { due_date: "2026-10-20" }, byId)).toBeNull();
  });
  it("el vencimiento no puede ser anterior al inicio", () => {
    const withStart = makeTask({ id: taskId(4), start_date: "2026-10-10", due_date: "2026-10-15" });
    expect(validateCellChange(withStart, { due_date: "2026-10-09" }, new Map())).toMatch(/inicio/);
  });
  it("proyecto de mas de 80", () => {
    expect(validateCellChange(A, { project: "x".repeat(81) }, byId)).toMatch(/80/);
  });
  it("limpiar la fecha siempre se puede", () => {
    expect(validateCellChange(B, { due_date: null }, byId)).toBeNull();
  });
});

describe("teclado (F11)", () => {
  it("editando: Enter confirma, Esc cancela, Tab confirma y avanza, Shift+Tab retrocede", () => {
    expect(cellKeyAction({ key: "Enter", editing: true })).toBe("commit");
    expect(cellKeyAction({ key: "Escape", editing: true })).toBe("cancel");
    expect(cellKeyAction({ key: "Tab", editing: true })).toBe("commit-next");
    expect(cellKeyAction({ key: "Tab", shiftKey: true, editing: true })).toBe("commit-prev");
    expect(cellKeyAction({ key: "a", editing: true })).toBe("none");
  });
  it("sin editar: Enter y F2 abren el editor; el resto, nada", () => {
    expect(cellKeyAction({ key: "Enter", editing: false })).toBe("open");
    expect(cellKeyAction({ key: "F2", editing: false })).toBe("open");
    expect(cellKeyAction({ key: "Escape", editing: false })).toBe("none");
  });
  it("en un campo de varias lineas, Enter es un salto de linea y Ctrl+Enter confirma", () => {
    expect(cellKeyAction({ key: "Enter", editing: true, multiline: true })).toBe("none");
    expect(cellKeyAction({ key: "Enter", editing: true, multiline: true, ctrlKey: true })).toBe("commit");
  });
  it("la celda siguiente recorre las columnas y salta de fila; fuera de la tabla, null", () => {
    expect(neighborCell({ row: 0, col: 0 }, 1, 3, 4)).toEqual({ row: 0, col: 1 });
    expect(neighborCell({ row: 0, col: 3 }, 1, 3, 4)).toEqual({ row: 1, col: 0 });
    expect(neighborCell({ row: 1, col: 0 }, -1, 3, 4)).toEqual({ row: 0, col: 3 });
    expect(neighborCell({ row: 2, col: 3 }, 1, 3, 4)).toBeNull();
    expect(neighborCell({ row: 0, col: 0 }, -1, 3, 4)).toBeNull();
  });
});

describe("campos del drawer", () => {
  const t = makeTask({ id: taskId(7), start_date: "2026-10-10", due_date: "2026-10-15" });
  it("la descripcion y el inicio se aplican en pantalla", () => {
    const { next } = applyOptimistic([t], t.id, { description: "texto", start_date: "2026-10-12" });
    expect(next[0]).toMatchObject({ description: "texto", start_date: "2026-10-12" });
  });
  it("valida la descripcion y el orden de las fechas", () => {
    expect(validateCellChange(t, { description: "x".repeat(5001) }, new Map())).toMatch(/5000/);
    expect(validateCellChange(t, { start_date: "2026-10-20" }, new Map())).toMatch(/inicio/);
    expect(validateCellChange(t, { start_date: "2026-10-11", due_date: "2026-10-30" }, new Map())).toBeNull();
    expect(validateCellChange(t, { start_date: null }, new Map())).toBeNull();
  });
});

describe("hora y duracion en la celda (R6)", () => {
  it("aplica la hora y la duracion en pantalla", () => {
    const { next } = applyOptimistic([A], A.id, { due_time: "14:30", duration_minutes: 45 });
    expect(next[0]).toMatchObject({ due_date: "2026-10-20", due_time: "14:30", duration_minutes: 45 });
  });
  it("quitar la fecha quita la hora y la duracion", () => {
    const timed = makeTask({ id: taskId(7), due_date: "2026-10-20", due_time: "14:30", duration_minutes: 45 });
    const { next, previous } = applyOptimistic([timed], timed.id, { due_date: null });
    expect(next[0]).toMatchObject({ due_date: null, due_time: null, duration_minutes: null });
    expect(previous).toMatchObject({ due_time: "14:30", duration_minutes: 45 });
  });
  it("cambiar solo el dia conserva la hora y la duracion", () => {
    const timed = makeTask({ id: taskId(7), due_date: "2026-10-20", due_time: "14:30", duration_minutes: 45 });
    const { next } = applyOptimistic([timed], timed.id, { due_date: "2026-10-27" });
    expect(next[0]).toMatchObject({ due_date: "2026-10-27", due_time: "14:30", duration_minutes: 45 });
  });
  it("valida antes de molestar al servidor: hora sin fecha, hora invalida, duracion fuera de rango", () => {
    const noDate = makeTask({ id: taskId(8), due_date: null });
    expect(validateCellChange(noDate, { due_time: "10:00" }, new Map())).toBe("La hora necesita una fecha de vencimiento.");
    expect(validateCellChange(A, { due_time: "25:00" }, new Map())).toBe("La hora no es válida.");
    expect(validateCellChange(A, { duration_minutes: 3 }, new Map())).toBe("La duración tiene que ser de 5 a 1440 minutos.");
    expect(validateCellChange(A, { due_time: "10:00", duration_minutes: 30 }, new Map())).toBeNull();
    expect(validateCellChange(A, { due_time: null }, new Map())).toBeNull();
  });
});
