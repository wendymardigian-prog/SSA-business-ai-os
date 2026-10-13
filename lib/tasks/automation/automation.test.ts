import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { makeTask, taskId } from "../fixtures";
import { emitTaskEvent } from "./emit";
import { eventSubjectPerson, isTaskEventType, parseTaskPayload, taskDedupeKey, taskEventPayload } from "./payload";
import { parseTaskTriggerConfig, taskEventMatches } from "./trigger-config";
import { taskVariables, TASK_VARIABLE_FIELDS } from "./variables";

const T = makeTask({ id: taskId(1), title: "Enviar propuesta", project: "Lanzamiento Q4", project_key: "lanzamiento q4", status: "completed", source: "flow", priority: "high", due_date: "2026-10-20", completed_at: "2026-10-13T18:00:00.000Z", owner_id: "u-owner", created_by: "u-creator", contact_id: null });

describe("payload (F25)", () => {
  it("solo escalares y NUNCA booking_id", () => {
    const p = taskEventPayload(T);
    expect(p).toEqual({ task_id: T.id, title: "Enviar propuesta", project: "Lanzamiento Q4", project_key: "lanzamiento q4", status: "completed", source: "flow", priority: "high", due_date: "2026-10-20", completed_at: "2026-10-13T18:00:00.000Z" });
    expect(Object.values(p).every((v) => typeof v === "string")).toBe(true);
    expect(Object.keys(p)).not.toContain("booking_id");
  });
  it("lo que falta queda en texto vacio", () => {
    const p = taskEventPayload({ ...T, project: null, project_key: null, due_date: null, completed_at: null });
    expect(p).toMatchObject({ project: "", project_key: "", due_date: "", completed_at: "" });
  });
  it("parseTaskPayload: lee el payload y rechaza lo que no es", () => {
    expect(parseTaskPayload(taskEventPayload(T))?.task_id).toBe(T.id);
    expect(parseTaskPayload(null)).toBeNull();
    expect(parseTaskPayload([])).toBeNull();
    expect(parseTaskPayload({ title: "x" })).toBeNull();
  });
  it("isTaskEventType", () => {
    expect(isTaskEventType("task_completed")).toBe(true);
    expect(isTaskEventType("task_overdue")).toBe(true);
    expect(isTaskEventType("sale_created")).toBe(false);
  });
  it("sin contacto: responsable, si no quien la creo, si no quien actua, si no nadie", () => {
    expect(eventSubjectPerson({ owner_id: "a", created_by: "b" }, "c")).toBe("a");
    expect(eventSubjectPerson({ owner_id: null, created_by: "b" }, "c")).toBe("b");
    expect(eventSubjectPerson({ owner_id: null, created_by: null }, "c")).toBe("c");
    expect(eventSubjectPerson({ owner_id: null, created_by: null }, null)).toBeNull();
  });
  it("idempotencia: completar de nuevo (otro completed_at) dispara; vencida, una vez por vencimiento", () => {
    const first = taskDedupeKey("task_completed", taskEventPayload(T), "e1");
    const again = taskDedupeKey("task_completed", taskEventPayload({ ...T, completed_at: "2026-10-14T09:00:00.000Z" }), "e2");
    expect(first).not.toBe(again);
    expect(taskDedupeKey("task_completed", taskEventPayload(T), "e9")).toBe(first);
    expect(taskDedupeKey("task_overdue", taskEventPayload(T), "e1")).toBe(taskDedupeKey("task_overdue", taskEventPayload(T), "e2"));
    expect(taskDedupeKey("task_overdue", taskEventPayload({ ...T, due_date: "2026-10-25" }), "e1")).not.toBe(taskDedupeKey("task_overdue", taskEventPayload(T), "e1"));
    expect(taskDedupeKey("task_completed", { nada: 1 }, "e7")).toBe("event:e7");
  });
});

describe("filtros del disparador (F25)", () => {
  const payload = taskEventPayload(T);
  it("sin filtro (o sin config) dispara con cualquier tarea", () => {
    expect(taskEventMatches({}, payload)).toBe(true);
    expect(taskEventMatches(null, payload)).toBe(true);
    expect(taskEventMatches(undefined, payload)).toBe(true);
    expect(taskEventMatches({ projects: [], sources: [] }, payload)).toBe(true);
  });
  it("por proyecto: la clave se normaliza (mayusculas, acentos, espacios)", () => {
    expect(taskEventMatches({ projects: ["Lanzamiento   Q4"] }, payload)).toBe(true);
    expect(taskEventMatches({ projects: ["LANZAMIENTO Q4", "otro"] }, payload)).toBe(true);
    expect(taskEventMatches({ projects: ["Operaciones"] }, payload)).toBe(false);
    expect(taskEventMatches({ projects: ["lanzamiento q4"] }, taskEventPayload({ ...T, project: null, project_key: null }))).toBe(false);
  });
  it("por origen", () => {
    expect(taskEventMatches({ sources: ["flow", "agent"] }, payload)).toBe(true);
    expect(taskEventMatches({ sources: ["manual"] }, payload)).toBe(false);
  });
  it("proyecto Y origen se combinan", () => {
    expect(taskEventMatches({ projects: ["Lanzamiento Q4"], sources: ["manual"] }, payload)).toBe(false);
    expect(taskEventMatches({ projects: ["Lanzamiento Q4"], sources: ["flow"] }, payload)).toBe(true);
  });
  it("una configuracion ROTA no dispara para nadie", () => {
    expect(parseTaskTriggerConfig({ projects: "no es lista" })).toBeNull();
    expect(parseTaskTriggerConfig({ sources: ["magia"] })).toBeNull();
    expect(parseTaskTriggerConfig([1, 2])).toBeNull();
    expect(taskEventMatches({ projects: 5 }, payload)).toBe(false);
    expect(taskEventMatches({ sources: ["magia"] }, payload)).toBe(false);
  });
  it("un payload roto no dispara", () => {
    expect(taskEventMatches({}, { nada: 1 })).toBe(false);
  });
});

describe("variables {{task.*}}", () => {
  it("todo texto, con el estado y la prioridad en castellano y la fecha legible", () => {
    const v = taskVariables({ payload: taskEventPayload(T), ownerName: "Ana", url: "https://app.test/dashboard/tareas?task=1" }) as { task: Record<string, string> };
    expect(v.task).toEqual({ id: T.id, title: "Enviar propuesta", project: "Lanzamiento Q4", status: "Completada", priority: "Alta", source: "flow", due_date: "20/10/2026", owner: "Ana", url: "https://app.test/dashboard/tareas?task=1" });
  });
  it("sin fecha ni responsable, vacio", () => {
    const v = taskVariables({ payload: taskEventPayload({ ...T, due_date: null }), ownerName: "", url: "u" }) as { task: Record<string, string> };
    expect(v.task.due_date).toBe("");
    expect(v.task.owner).toBe("");
  });
  it("los campos comparables son de texto y estan en el catalogo", () => {
    expect(TASK_VARIABLE_FIELDS.map((f) => f.path)).toEqual(["task.title", "task.project", "task.status", "task.priority", "task.source", "task.due_date", "task.owner"]);
  });
});

describe("emitTaskEvent (F25)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("con contacto: el evento viaja con el contacto y sin persona", async () => {
    const db = memoryDb({ automation_events: [] });
    expect(await emitTaskEvent(db.client, "task_completed", { ...T, contact_id: "c-1" })).toBe(true);
    expect(db.rows("automation_events")[0]).toMatchObject({ workspace_id: T.workspace_id, event_type: "task_completed", contact_id: "c-1", member_user_id: null });
  });

  it("sin contacto: viaja con la persona a cargo", async () => {
    const db = memoryDb({ automation_events: [] });
    await emitTaskEvent(db.client, "task_completed", T);
    expect(db.rows("automation_events")[0]).toMatchObject({ contact_id: null, member_user_id: "u-owner" });
    await emitTaskEvent(db.client, "task_completed", { ...T, owner_id: null }, "u-actor");
    expect(db.rows("automation_events")[1]).toMatchObject({ member_user_id: "u-creator" });
    await emitTaskEvent(db.client, "task_completed", { ...T, owner_id: null, created_by: null }, "u-actor");
    expect(db.rows("automation_events")[2]).toMatchObject({ member_user_id: "u-actor" });
  });

  it("sin contacto ni persona: no emite (el motor necesita un sujeto)", async () => {
    const db = memoryDb({ automation_events: [] });
    expect(await emitTaskEvent(db.client, "task_overdue", { ...T, owner_id: null, created_by: null })).toBe(false);
    expect(db.rows("automation_events")).toHaveLength(0);
  });

  it("NUNCA lanza: un error de la base devuelve false", async () => {
    const insertFails = { from: () => ({ insert: async () => ({ error: { message: "caida" } }) }) } as never;
    expect(await emitTaskEvent(insertFails, "task_completed", T)).toBe(false);
    const throws = { from: () => { throw new Error("explota"); } } as never;
    expect(await emitTaskEvent(throws, "task_completed", T)).toBe(false);
  });
});
