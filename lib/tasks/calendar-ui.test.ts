import { describe, expect, it } from "vitest";
import { isDraggableTask, monthChipText, parseTasksMode, tasksModeParam, undatedTasks, UNDATED_LIMIT } from "./calendar-ui";
import { makeTask, taskId } from "./fixtures";

describe("calendar-ui (R7)", () => {
  it("las completadas no se arrastran, y sin permiso de editar tampoco nada", () => {
    expect(isDraggableTask({ status: "pending" }, true)).toBe(true);
    expect(isDraggableTask({ status: "in_progress" }, true)).toBe(true);
    expect(isDraggableTask({ status: "completed" }, true)).toBe(false);
    expect(isDraggableTask({ status: "pending" }, false)).toBe(false);
  });

  it("monthChipText: con hora o «Sin hora»", () => {
    expect(monthChipText({ title: "Llamar", due_time: "09:30:00" }, "24h")).toBe("09:30 Llamar");
    expect(monthChipText({ title: "Llamar", due_time: "14:30" }, "12h")).toBe("2:30 p. m. Llamar");
    expect(monthChipText({ title: "Llamar", due_time: null }, "24h")).toBe("Sin hora · Llamar");
  });

  describe("undatedTasks", () => {
    const tasks = [
      makeTask({ id: taskId(1), title: "Preparar contrato", due_date: null, created_at: "2026-10-01T00:00:00Z" }),
      makeTask({ id: taskId(2), title: "Llamar a Ana", due_date: null, created_at: "2026-10-03T00:00:00Z" }),
      makeTask({ id: taskId(3), title: "Con fecha", due_date: "2026-10-20" }),
      makeTask({ id: taskId(4), title: "Hecha", due_date: null, status: "completed" }),
      makeTask({ id: taskId(5), title: "Borrada", due_date: null, deleted_at: "2026-10-02T00:00:00Z" }),
    ];
    it("solo abiertas, sin fecha y no borradas; las mas nuevas primero", () => {
      expect(undatedTasks(tasks, "").rows.map((t) => t.title)).toEqual(["Llamar a Ana", "Preparar contrato"]);
    });
    it("el buscador ignora mayusculas y acentos", () => {
      expect(undatedTasks(tasks, "  CONTRATO ").rows.map((t) => t.title)).toEqual(["Preparar contrato"]);
      expect(undatedTasks(tasks, "nada").rows).toEqual([]);
    });
    it("hasta 50, y dice cuantas hay en total", () => {
      const many = Array.from({ length: 70 }, (_, i) => makeTask({ id: taskId(100 + i), title: `t${i}`, due_date: null }));
      const res = undatedTasks(many, "");
      expect(res.rows).toHaveLength(UNDATED_LIMIT);
      expect(res.total).toBe(70);
    });
  });

  it("el modo de tareas en la URL", () => {
    expect(parseTasksMode(undefined, true)).toBe("off");
    expect(parseTasksMode("1", true)).toBe("mine");
    expect(parseTasksMode("todas", true)).toBe("all");
    expect(parseTasksMode(["todas", "1"], true)).toBe("all");
    expect(parseTasksMode("otro", true)).toBe("off");
    // Sin permiso de ver tareas, el parametro se ignora.
    expect(parseTasksMode("todas", false)).toBe("off");
    expect(tasksModeParam("off")).toBeNull();
    expect(tasksModeParam("mine")).toBe("1");
    expect(tasksModeParam("all")).toBe("todas");
  });
});
