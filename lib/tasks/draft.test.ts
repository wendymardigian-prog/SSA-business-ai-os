import { describe, it, expect } from "vitest";
import { applyDraftPatch, draftFromDefaults, draftProblem, valuesFromTask } from "./draft";
import { makeTask } from "./fixtures";

describe("borrador de una tarea nueva (F12, F15)", () => {
  it("por defecto el responsable es quien la crea", () => {
    expect(draftFromDefaults(undefined, "me").owner_id).toBe("me");
    expect(draftFromDefaults({ owner_id: null }, "me").owner_id).toBeNull();
    expect(draftFromDefaults({ owner_id: "otro" }, "me").owner_id).toBe("otro");
  });
  it("precarga titulo, prioridad y proyecto normalizado", () => {
    const d = draftFromDefaults({ title: "Dar seguimiento a Ana", priority: "high", project: " Lanzamiento  Q4 " }, "me");
    expect(d).toMatchObject({ title: "Dar seguimiento a Ana", priority: "high", project: "Lanzamiento Q4", projectKey: "lanzamiento q4", status: "pending" });
  });
  it("el responsable no queda como seguidor", () => {
    expect(draftFromDefaults({ follower_ids: ["me", "x"] }, "me").follower_ids).toEqual(["x"]);
    const d = applyDraftPatch(draftFromDefaults({ follower_ids: ["a", "b"] }, "me"), { owner_id: "a" });
    expect(d.follower_ids).toEqual(["b"]);
  });
  it("aplica cada campo sin tocar los demas", () => {
    const base = draftFromDefaults({ title: "x" }, "me");
    expect(applyDraftPatch(base, { due_date: "2026-10-20", priority: "urgent" })).toMatchObject({ title: "x", due_date: "2026-10-20", priority: "urgent" });
    expect(applyDraftPatch(base, { project: "Nuevo" })).toMatchObject({ project: "Nuevo", projectKey: "nuevo" });
    expect(applyDraftPatch(applyDraftPatch(base, { project: "Nuevo" }), { project: null })).toMatchObject({ project: null, projectKey: null });
  });
  it("problemas para crear", () => {
    expect(draftProblem(draftFromDefaults({ title: "  " }, "me"))).toMatch(/título/);
    expect(draftProblem(draftFromDefaults({ title: "a", start_date: "2026-10-20", due_date: "2026-10-10" }, "me"))).toMatch(/inicio/);
    expect(draftProblem(draftFromDefaults({ title: "a" }, "me"))).toBeNull();
  });
  it("valuesFromTask copia lo editable", () => {
    const t = makeTask({ title: "T", project: "P", project_key: "p", follower_ids: ["a"] });
    expect(valuesFromTask(t)).toMatchObject({ title: "T", project: "P", projectKey: "p", follower_ids: ["a"] });
  });
});
