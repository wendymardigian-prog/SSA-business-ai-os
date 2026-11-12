import { describe, expect, it } from "vitest";
import { addChecklistItem, checklistCompletesTask, checklistFromTemplate, checklistProgress, readChecklist, removeChecklistItem, toggleChecklistItem, TASK_CHECKLIST_MAX } from "./checklist";

let n = 0;
const id = () => `c${++n}`;

describe("checklist de la tarea", () => {
  it("nace con los puntos del paso, sin tildar", () => {
    const list = checklistFromTemplate(["Uno", " Dos ", "", "Tres"], id);
    expect(list.map((x) => [x.text, x.done])).toEqual([["Uno", false], ["Dos", false], ["Tres", false]]);
  });
  it("sumar, tildar y quitar", () => {
    let list = checklistFromTemplate(["Uno"], id);
    const added = addChecklistItem(list, "Dos", id);
    expect(added.ok).toBe(true);
    if (added.ok) list = added.list;
    list = toggleChecklistItem(list, list[1].id, true, "u1", "2026-11-12T10:00:00Z");
    expect(list[1]).toMatchObject({ done: true, done_by: "u1" });
    list = toggleChecklistItem(list, list[1].id, false, "u1", "2026-11-12T10:01:00Z");
    expect(list[1]).toMatchObject({ done: false, done_by: null });
    expect(removeChecklistItem(list, list[0].id)).toHaveLength(1);
  });
  it("tope de 30 en la tarea y puntos válidos", () => {
    const full = checklistFromTemplate(Array.from({ length: TASK_CHECKLIST_MAX }, (_, i) => `P${i}`), id);
    expect(addChecklistItem(full, "otro", id).ok).toBe(false);
    expect(addChecklistItem([], "  ", id).ok).toBe(false);
    expect(addChecklistItem([], "x".repeat(201), id).ok).toBe(false);
  });
  it("«N de M» y tildar todos no completa la tarea", () => {
    const list = toggleChecklistItem(checklistFromTemplate(["a", "b"], id), "x", true, "u", "t");
    expect(checklistProgress(list)?.label).toBe("0 de 2");
    expect(checklistProgress([])).toBeNull();
    expect(checklistCompletesTask()).toBe(false);
  });
  it("lee tolerante", () => {
    expect(readChecklist([{ id: "a", text: "t", done: true }, { nada: 1 }, "x"])).toEqual([{ id: "a", text: "t", done: true, done_by: null, done_at: null }]);
  });
});
