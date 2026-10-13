import { describe, it, expect } from "vitest";
import { RECENT_COMPLETED, splitOpenDone, tasksForContact } from "./contact-tasks";
import { makeTask, taskId } from "./fixtures";

describe("tareas de un contacto (R1)", () => {
  it("splitOpenDone: abiertas por vencimiento con las sin fecha al final; completadas, la mas reciente primero", () => {
    const rows = [
      makeTask({ id: taskId(1), title: "sin fecha", due_date: null }),
      makeTask({ id: taskId(2), title: "tarde", due_date: "2026-10-30" }),
      makeTask({ id: taskId(3), title: "pronto", due_date: "2026-10-14", status: "in_progress" }),
      makeTask({ id: taskId(4), title: "vieja", status: "completed", completed_at: "2026-10-01T10:00:00Z" }),
      makeTask({ id: taskId(5), title: "nueva", status: "completed", completed_at: "2026-10-09T10:00:00Z" }),
    ];
    const { open, done } = splitOpenDone(rows);
    expect(open.map((t) => t.title)).toEqual(["pronto", "tarde", "sin fecha"]);
    expect(done.map((t) => t.title)).toEqual(["nueva", "vieja"]);
  });

  it("empata por creacion: la mas vieja primero", () => {
    const a = makeTask({ id: taskId(1), due_date: "2026-10-14", created_at: "2026-10-02T10:00:00Z" });
    const b = makeTask({ id: taskId(2), due_date: "2026-10-14", created_at: "2026-10-01T10:00:00Z" });
    expect(splitOpenDone([a, b]).open.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it("tasksForContact: solo ese contacto, sin borradas, y como mucho 5 completadas", () => {
    const cid = "c-1";
    const rows = [
      makeTask({ id: taskId(1), title: "abierta", contact_id: cid, due_date: "2026-10-20" }),
      makeTask({ id: taskId(2), title: "de otro", contact_id: "c-2", due_date: "2026-10-10" }),
      makeTask({ id: taskId(3), title: "borrada", contact_id: cid, deleted_at: "2026-10-05T00:00:00Z" }),
      ...Array.from({ length: 8 }, (_, i) => makeTask({ id: taskId(10 + i), title: `hecha ${i}`, contact_id: cid, status: "completed", completed_at: `2026-10-0${i + 1}T10:00:00Z` })),
    ];
    const { open, done } = tasksForContact(rows, cid);
    expect(open.map((t) => t.title)).toEqual(["abierta"]);
    expect(done).toHaveLength(RECENT_COMPLETED);
    expect(done[0].title).toBe("hecha 7");
  });

  it("sin tareas devuelve listas vacias", () => {
    expect(tasksForContact([], "c-1")).toEqual({ open: [], done: [] });
  });
});
