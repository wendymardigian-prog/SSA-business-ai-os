import { describe, expect, it } from "vitest";
import { contactListPlan, parseContactListFilters } from "../list-query";
import { taskCells } from "./tasks";

const A = "9f0d1b6e-1111-2222-3333-444455556666";

describe("tareas en la lista de contactos", () => {
  it("tareas abiertas: sin borrar y sin completar", () => {
    const p = contactListPlan(parseContactListFilters({ tareas: "no" }, []));
    expect(p.embeds).toEqual(["sin_tasks_1:tasks(status,deleted_at)"]);
    expect(p.clauses).toEqual(
      expect.arrayContaining([
        { op: "is_null", column: "sin_tasks_1.deleted_at" },
        { op: "neq", column: "sin_tasks_1.status", value: "completed" },
        { op: "is_null", column: "sin_tasks_1" },
      ]),
    );
  });

  it("las columnas: cuántas abiertas y la próxima que vence (las sin fecha no)", () => {
    const rows = [
      { contact_id: A, due_date: "2026-11-05", title: "Llamar" },
      { contact_id: A, due_date: null, title: "Sin fecha" },
    ];
    const cells = taskCells([A], ["open_tasks", "next_task"], rows)[A];
    expect(cells.open_tasks).toEqual({ t: "number", n: 2 });
    expect(cells.next_task).toEqual({ t: "date", at: "2026-11-05T12:00:00Z", mode: "day", sub: "Llamar" });
  });
});
