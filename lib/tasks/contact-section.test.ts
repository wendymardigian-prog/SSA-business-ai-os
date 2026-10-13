import { describe, it, expect } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { loadContactTasks, pickContactTasks, RECENT_COMPLETED } from "./contact-section";
import { makeTask, taskId } from "./fixtures";

describe("tareas de un contacto (F20)", () => {
  it("abiertas por vencimiento (sin fecha al final) y las ultimas completadas", () => {
    const rows = [
      makeTask({ id: taskId(1), title: "sin fecha", due_date: null }),
      makeTask({ id: taskId(2), title: "tarde", due_date: "2026-10-30" }),
      makeTask({ id: taskId(3), title: "pronto", due_date: "2026-10-14" }),
      ...Array.from({ length: 8 }, (_, i) => makeTask({ id: taskId(10 + i), title: `hecha ${i}`, status: "completed", completed_at: `2026-10-0${i + 1}T10:00:00Z` })),
    ];
    const { open, completed } = pickContactTasks(rows);
    expect(open.map((t) => t.title)).toEqual(["pronto", "tarde", "sin fecha"]);
    expect(completed).toHaveLength(RECENT_COMPLETED);
    expect(completed[0].title).toBe("hecha 7");
  });

  it("lee por contacto y workspace, sin borradas; un error devuelve vacio sin lanzar", async () => {
    const ok = fakeDb({ tasks: { data: [makeTask({ id: taskId(1), title: "a", due_date: "2026-10-14" })] } });
    const rows = await loadContactTasks(ok.client, { workspaceId: "ws", contactId: "c1" });
    expect(rows).toHaveLength(1);
    const filters = ok.calls[0].filters.map((f) => `${f.method}:${f.column}`);
    expect(filters).toEqual(expect.arrayContaining(["eq:workspace_id", "eq:contact_id", "is:deleted_at"]));
    const bad = fakeDb({ tasks: { error: { message: "rls" } } });
    expect(await loadContactTasks(bad.client, { workspaceId: "ws", contactId: "c1" })).toEqual([]);
  });
});
