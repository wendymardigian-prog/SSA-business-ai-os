import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

import { handleTasksDueSweep, isSweepWindow, registerTasksDueSweepHandler, runTasksDueSweep, TASKS_DUE_SWEEP_JOB } from "./tasks-due-sweep";
import { getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";

const WS = "ws-1";
const OWNER = "u-owner";
const F1 = "u-f1";
const F2 = "u-f2";
const TODAY = "2026-10-13";

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: WS, title: `Tarea ${id}`, status: "pending", due_date: TODAY, owner_id: OWNER, follower_ids: [F1, F2], deleted_at: null, ...over,
});

const notices = (db: ReturnType<typeof memoryDb>) => db.rows("notifications").map((n) => `${n.type}:${n.entity_id}:${n.recipient_id}`).sort();

beforeEach(() => resetJobHandlers());

describe("isSweepWindow (F18)", () => {
  it("a las 07:59 locales no; a las 08:00 si (America/Costa_Rica, UTC-6)", () => {
    expect(isSweepWindow(new Date("2026-10-13T13:59:00Z"), "America/Costa_Rica")).toBe(false);
    expect(isSweepWindow(new Date("2026-10-13T14:00:00Z"), "America/Costa_Rica")).toBe(true);
    expect(isSweepWindow(new Date("2026-10-13T23:30:00Z"), "America/Costa_Rica")).toBe(true);
    expect(isSweepWindow(new Date("2026-10-13T12:59:00Z"), "America/Costa_Rica")).toBe(false); // 06:59 locales
  });
  it("depende de la zona de cada workspace", () => {
    const instant = new Date("2026-10-13T14:00:00Z"); // 08:00 en Costa Rica, 16:00 en Madrid, 07:00 en Los Angeles... (DST) = 07:00 PDT
    expect(isSweepWindow(instant, "Europe/Madrid")).toBe(true);
    expect(isSweepWindow(instant, "America/Los_Angeles")).toBe(false);
  });
});

describe("runTasksDueSweep (F18)", () => {
  it("vence hoy: aviso al responsable y a cada seguidor", async () => {
    const db = memoryDb({ tasks: [task("t1")], notifications: [] });
    const r = await runTasksDueSweep(db.client, WS, TODAY);
    expect(r).toEqual({ dueToday: 3, overdue: 0 });
    expect(notices(db)).toEqual([`task_due_today:t1:${F1}`, `task_due_today:t1:${F2}`, `task_due_today:t1:${OWNER}`].sort());
    expect(db.rows("notifications")[0]).toMatchObject({ entity_type: "task", workspace_id: WS });
    expect(db.rows("notifications").every((n) => (n.metadata as { due_date: string }).due_date === TODAY)).toBe(true);
  });

  it("vencida: solo al responsable", async () => {
    const db = memoryDb({ tasks: [task("t1", { due_date: "2026-10-10" })], notifications: [] });
    await runTasksDueSweep(db.client, WS, TODAY);
    expect(notices(db)).toEqual([`task_overdue:t1:${OWNER}`]);
  });

  it("IDEMPOTENTE: correrlo dos veces no duplica los avisos", async () => {
    const db = memoryDb({ tasks: [task("t1"), task("t2", { due_date: "2026-10-01" })], notifications: [] });
    await runTasksDueSweep(db.client, WS, TODAY);
    const first = notices(db);
    const second = await runTasksDueSweep(db.client, WS, TODAY);
    expect(second).toEqual({ dueToday: 0, overdue: 0 });
    expect(notices(db)).toEqual(first);
  });

  it("una vencida avisa UNA sola vez: al dia siguiente no repite", async () => {
    const db = memoryDb({ tasks: [task("t1", { due_date: "2026-10-10" })], notifications: [] });
    await runTasksDueSweep(db.client, WS, "2026-10-13");
    const day2 = await runTasksDueSweep(db.client, WS, "2026-10-14");
    expect(day2.overdue).toBe(0);
    expect(db.rows("notifications")).toHaveLength(1);
  });

  it("si cambia el vencimiento, la nueva fecha vuelve a avisar", async () => {
    const db = memoryDb({ tasks: [task("t1", { due_date: "2026-10-10" })], notifications: [] });
    await runTasksDueSweep(db.client, WS, "2026-10-13");
    db.rows("tasks")[0].due_date = "2026-10-12";
    const again = await runTasksDueSweep(db.client, WS, "2026-10-14");
    expect(again.overdue).toBe(1);
  });

  it("no avisa de completadas, borradas, futuras ni de las que no tienen a nadie", async () => {
    const db = memoryDb({
      tasks: [
        task("done", { status: "completed" }),
        task("gone", { deleted_at: "2026-10-12T00:00:00Z" }),
        task("future", { due_date: "2026-10-20" }),
        task("nobody", { owner_id: null, follower_ids: [] }),
        task("nodue", { due_date: null }),
      ],
      notifications: [],
    });
    expect(await runTasksDueSweep(db.client, WS, TODAY)).toEqual({ dueToday: 0, overdue: 0 });
  });

  it("solo seguidores (sin responsable): vence hoy les avisa; vencida no avisa a nadie", async () => {
    const db = memoryDb({
      tasks: [task("t1", { owner_id: null, follower_ids: [F1] }), task("t2", { owner_id: null, follower_ids: [F1], due_date: "2026-10-01" })],
      notifications: [],
    });
    await runTasksDueSweep(db.client, WS, TODAY);
    expect(notices(db)).toEqual([`task_due_today:t1:${F1}`]);
  });

  it("solo mira las tareas de ese workspace", async () => {
    const db = memoryDb({ tasks: [task("t1"), { ...task("t2"), workspace_id: "otro" }], notifications: [] });
    await runTasksDueSweep(db.client, WS, TODAY);
    expect(db.rows("notifications").every((n) => n.entity_id === "t1")).toBe(true);
  });

  it("todos los avisos van a una persona concreta (nunca null)", async () => {
    const db = memoryDb({ tasks: [task("t1"), task("t2", { due_date: "2026-10-01" })], notifications: [] });
    await runTasksDueSweep(db.client, WS, TODAY);
    expect(db.rows("notifications").every((n) => typeof n.recipient_id === "string" && n.recipient_id)).toBe(true);
  });

  it("un error de la base lanza (la cola reintenta)", async () => {
    const bad = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ neq: () => ({ lte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "caida" } }) }) }) }) }) }) }) }) };
    await expect(runTasksDueSweep(bad as never, WS, TODAY)).rejects.toThrow("caida");
  });
});

describe("el handler", () => {
  it("se registra con su tipo", () => {
    registerTasksDueSweepHandler();
    expect(getJobHandler(TASKS_DUE_SWEEP_JOB)).toBeTypeOf("function");
  });

  it("un payload roto no hace nada", async () => {
    const db = memoryDb({ tasks: [task("t1")], notifications: [], workspaces: [{ id: WS, timezone: "UTC" }] });
    await handleTasksDueSweep({ supabase: db.client, job: { id: "j", type: TASKS_DUE_SWEEP_JOB, payload: { workspace_id: WS, local_date: "mañana" }, attempts: 0 } } as never);
    await handleTasksDueSweep({ supabase: db.client, job: { id: "j", type: TASKS_DUE_SWEEP_JOB, payload: null, attempts: 0 } } as never);
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("corre para el dia del payload (no «hoy»)", async () => {
    const db = memoryDb({ tasks: [task("t1", { due_date: "2020-01-01" })], notifications: [], workspaces: [{ id: WS, timezone: "UTC" }] });
    await handleTasksDueSweep({ supabase: db.client, job: { id: "j", type: TASKS_DUE_SWEEP_JOB, payload: { workspace_id: WS, local_date: "2020-01-02" }, attempts: 0 } } as never);
    expect(notices(db)).toEqual([`task_overdue:t1:${OWNER}`]);
  });

  it("un job del dia de hoy no avisa antes de las 08:00 locales", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T11:00:00Z")); // 05:00 en Costa Rica
    const db = memoryDb({ tasks: [task("t1")], notifications: [], workspaces: [{ id: WS, timezone: "America/Costa_Rica" }] });
    await handleTasksDueSweep({ supabase: db.client, job: { id: "j", type: TASKS_DUE_SWEEP_JOB, payload: { workspace_id: WS, local_date: TODAY }, attempts: 0 } } as never);
    vi.useRealTimers();
    expect(db.rows("notifications")).toHaveLength(0);
  });
});
