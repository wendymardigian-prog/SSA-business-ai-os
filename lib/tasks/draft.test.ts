import { describe, it, expect } from "vitest";
import { applyDraftPatch, draftFromDefaults, draftProblem, dueDatePatch, valuesFromTask, viewerDueDatePatch } from "./draft";
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

describe("hora y duracion en el borrador (R6)", () => {
  it("arranca sin hora ni duracion y las toma de una tarea existente normalizadas", () => {
    expect(draftFromDefaults(undefined, "me")).toMatchObject({ due_time: null, duration_minutes: null });
    expect(valuesFromTask(makeTask({ due_date: "2026-10-20", due_time: "14:30:00", duration_minutes: 60 }))).toMatchObject({ due_time: "14:30", duration_minutes: 60 });
  });
  it("borrar la fecha borra la hora y la duracion", () => {
    const d = applyDraftPatch(draftFromDefaults({ due_date: "2026-10-20" }, "me"), { due_time: "10:00", duration_minutes: 30 });
    expect(d).toMatchObject({ due_time: "10:00", duration_minutes: 30 });
    expect(applyDraftPatch(d, { due_date: null })).toMatchObject({ due_date: null, due_time: null, duration_minutes: null });
  });
});

describe("elegir la fecha en el drawer (una sola fecha)", () => {
  it("sin fecha de inicio, solo cambia el vencimiento", () => {
    expect(dueDatePatch({ start_date: null }, "2026-10-20")).toEqual({ due_date: "2026-10-20" });
    expect(dueDatePatch({ start_date: null }, null)).toEqual({ due_date: null });
  });
  it("si el inicio que ya traia queda despues de la fecha nueva, se quita para que la base no rechace el cambio", () => {
    expect(dueDatePatch({ start_date: "2026-10-25" }, "2026-10-20")).toEqual({ due_date: "2026-10-20", start_date: null });
  });
  it("si el inicio sigue siendo anterior o igual, se conserva", () => {
    expect(dueDatePatch({ start_date: "2026-10-10" }, "2026-10-20")).toEqual({ due_date: "2026-10-20" });
    expect(dueDatePatch({ start_date: "2026-10-20" }, "2026-10-20")).toEqual({ due_date: "2026-10-20" });
  });
  it("quitar la fecha no toca el inicio (la base ya lo valida solo)", () => {
    expect(dueDatePatch({ start_date: "2026-10-10" }, null)).toEqual({ due_date: null });
  });
});

describe("elegir la fecha en el drawer desde otra zona", () => {
  const zones = { workspaceTz: "America/Costa_Rica", viewerTz: "Asia/Tokyo" };
  // 23:00 del 14 en Costa Rica = 14:00 del 15 en Tokio.
  const timed = { start_date: null, due_date: "2026-10-14", due_time: "23:00" };

  it("con hora: el dia que elige quien mira se guarda convertido y la hora que ve se conserva", () => {
    // 14:00 del 20 en Tokio = 23:00 del 19 en Costa Rica.
    expect(viewerDueDatePatch(timed, "2026-10-20", zones)).toEqual({ due_date: "2026-10-19" });
  });
  it("sin hora: el dia tal cual", () => {
    expect(viewerDueDatePatch({ start_date: null, due_date: "2026-10-14", due_time: null }, "2026-10-20", zones)).toEqual({ due_date: "2026-10-20" });
  });
  it("quitar la fecha quita la hora", () => {
    expect(viewerDueDatePatch(timed, null, zones)).toEqual({ due_date: null, due_time: null });
  });
  it("el inicio se compara con lo guardado, como en la base", () => {
    // Quien mira elige el 20 (se guarda 19): un inicio del 20 queda despues del vencimiento guardado y se quita.
    expect(viewerDueDatePatch({ ...timed, start_date: "2026-10-20" }, "2026-10-20", zones)).toEqual({ due_date: "2026-10-19", start_date: null });
    expect(viewerDueDatePatch({ ...timed, start_date: "2026-10-19" }, "2026-10-20", zones)).toEqual({ due_date: "2026-10-19" });
  });
  it("con la misma zona, igual que siempre", () => {
    const same = { workspaceTz: zones.workspaceTz, viewerTz: zones.workspaceTz };
    expect(viewerDueDatePatch(timed, "2026-10-20", same)).toEqual({ due_date: "2026-10-20" });
  });
});
