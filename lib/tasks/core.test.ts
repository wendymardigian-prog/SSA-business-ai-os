import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: mocks.audit }));

import { completeTaskCore, createTaskCore, deleteTaskCore, planCompletionCore, setTaskBlockersCore, updateTaskCore, type TaskCtx } from "./core";
import type { TaskRow } from "./types";

const WS = "ws-1";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: T1, workspace_id: WS, title: "Enviar propuesta", description: null, status: "pending", priority: "normal",
  start_date: null, due_date: "2026-10-20", due_time: null, duration_minutes: null, completed_at: null, owner_id: ME, follower_ids: [], project: null, project_key: null,
  blocked_by: [], contact_id: null, conversation_id: null, source: "manual", source_ref: null, position: 0, created_by: ME,
  created_at: "2026-10-01T10:00:00.000000+00:00", updated_at: "2026-10-01T10:00:00.123456+00:00", deleted_at: null, ...over,
});

const has = (call: DbCall, method: string, column: string) => call.filters.some((f) => f.method === method && f.column === column);

function ctxWith(handlers: Parameters<typeof fakeDb>[0], rpcs: Parameters<typeof fakeDb>[1] = {}, service?: ReturnType<typeof fakeDb>) {
  const user = fakeDb(handlers, rpcs);
  const svc = service ?? fakeDb({ "workspace_members:select": { data: [{ user_id: ME }, { user_id: OTHER }] } });
  const ctx: TaskCtx = { supabase: user.client, service: svc.client, workspaceId: WS, userId: ME, timeZone: "America/Costa_Rica" };
  return { ctx, user, svc };
}

beforeEach(() => vi.clearAllMocks());

describe("createTaskCore (F8, F7)", () => {
  it("rechaza datos invalidos en castellano SIN tocar la base", async () => {
    const { ctx, user, svc } = ctxWith({});
    const bad: unknown[] = [
      { title: "" },
      { title: "x".repeat(201) },
      { title: "a", status: "hecho" },
      { title: "a", priority: "maxima" },
      { title: "a", due_date: "mañana" },
      { title: "a", follower_ids: Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) },
      { title: "a", start_date: "2026-10-20", due_date: "2026-10-10" },
    ];
    for (const input of bad) {
      const r = await createTaskCore(ctx, input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("validation");
        expect(r.error.length).toBeGreaterThan(5);
      }
    }
    expect(user.calls).toHaveLength(0);
    expect(svc.calls).toHaveLength(0);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un responsable que no es miembro se rechaza antes de escribir", async () => {
    const { ctx, user } = ctxWith({}, {}, fakeDb({ "workspace_members:select": { data: [{ user_id: ME }] } }));
    const r = await createTaskCore(ctx, { title: "a", owner_id: OUTSIDER });
    expect(r).toEqual({ ok: false, code: "validation", error: "El responsable tiene que ser parte del equipo." });
    expect(user.writes()).toHaveLength(0);
  });

  it("crea: la persona que la crea queda como creadora y, por defecto, como responsable; audita", async () => {
    const created = task({ title: "Enviar propuesta" });
    const { ctx, user } = ctxWith({ "tasks:insert": { data: [created] } });
    const r = await createTaskCore(ctx, { title: "  Enviar propuesta ", project: "Lanzamiento  Q4" });
    expect(r.ok).toBe(true);
    const values = user.writesTo("tasks")[0].values as Record<string, unknown>;
    expect(values).toMatchObject({ workspace_id: WS, title: "Enviar propuesta", owner_id: ME, created_by: ME, project: "Lanzamiento Q4", project_key: "lanzamiento q4", follower_ids: [] });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "task", action: "task.created", entityId: T1, performedBy: ME }));
    const changes = mocks.audit.mock.calls[0][0].changes;
    expect(changes.title).toEqual({ old: null, new: "Enviar propuesta" });
  });

  it("owner_id null explicito = sin responsable, y el responsable sale de los seguidores", async () => {
    const { ctx, user } = ctxWith({ "tasks:insert": { data: [task({ owner_id: null })] } });
    await createTaskCore(ctx, { title: "a", owner_id: null });
    expect((user.writesTo("tasks")[0].values as Record<string, unknown>).owner_id).toBeNull();
    const { ctx: ctx2, user: user2 } = ctxWith({ "tasks:insert": { data: [task()] } });
    await createTaskCore(ctx2, { title: "a", owner_id: ME, follower_ids: [ME, OTHER] });
    expect((user2.writesTo("tasks")[0].values as Record<string, unknown>).follower_ids).toEqual([OTHER]);
  });

  it("si la RLS rechaza la insercion, responde un error de permiso", async () => {
    const { ctx } = ctxWith({ "tasks:insert": { error: { message: "new row violates row-level security policy", code: "42501" } } });
    const r = await createTaskCore(ctx, { title: "a" });
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("no inventa campos que el cliente no puede mandar", async () => {
    const { ctx, user } = ctxWith({});
    const r = await createTaskCore(ctx, { title: "a", source: "agent", workspace_id: "otro" });
    expect(r.ok).toBe(false);
    expect(user.calls).toHaveLength(0);
  });
});

describe("updateTaskCore (F8, F7)", () => {
  it("una tarea que no se ve y una que no existe dan EL MISMO error", async () => {
    const { ctx } = ctxWith({ "tasks:select": { data: [] } });
    const a = await updateTaskCore(ctx, T1, { title: "x" });
    const b = await updateTaskCore(ctx, T2, { title: "y" });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, code: "forbidden", error: "No tenés permiso sobre esa tarea o ya no existe." });
  });

  it("completar no va por aca", async () => {
    const { ctx, user } = ctxWith({ "tasks:select": { data: [task()] } });
    const r = await updateTaskCore(ctx, T1, { status: "completed" });
    expect(r).toMatchObject({ ok: false, code: "use_complete" });
    expect(user.calls).toHaveLength(0);
  });

  it("valida el id y el parche en el servidor", async () => {
    const { ctx, user } = ctxWith({});
    expect(await updateTaskCore(ctx, "no-uuid", { title: "x" })).toMatchObject({ ok: false, code: "validation" });
    expect(await updateTaskCore(ctx, T1, {})).toMatchObject({ ok: false, code: "validation" });
    expect(await updateTaskCore(ctx, T1, { title: "" })).toMatchObject({ ok: false, code: "validation" });
    expect(user.calls).toHaveLength(0);
  });

  it("inicio posterior al vencimiento (mezclando lo guardado con lo nuevo) se rechaza", async () => {
    const { ctx, user } = ctxWith({ "tasks:select": { data: [task({ due_date: "2026-10-20" })] } });
    const r = await updateTaskCore(ctx, T1, { start_date: "2026-10-25" });
    expect(r).toMatchObject({ ok: false, code: "validation" });
    expect(user.writes()).toHaveLength(0);
  });

  it("una hora sin fecha se rechaza, mezclando lo nuevo con lo guardado (R6)", async () => {
    const { ctx, user } = ctxWith({ "tasks:select": { data: [task({ due_date: null })] } });
    const r = await updateTaskCore(ctx, T1, { due_time: "10:00" });
    expect(r).toMatchObject({ ok: false, code: "validation", error: "La hora necesita una fecha de vencimiento." });
    expect(user.writes()).toHaveLength(0);
  });

  it("borrar la fecha borra tambien la hora y la duracion en la misma escritura (R6)", async () => {
    const before = task({ due_date: "2026-10-20", due_time: "14:30:00", duration_minutes: 45 });
    const after = task({ due_date: null, due_time: null, duration_minutes: null, updated_at: "2026-10-02T10:00:00.000000+00:00" });
    const { ctx, user } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } });
    const r = await updateTaskCore(ctx, T1, { due_date: null });
    expect(r.ok).toBe(true);
    expect(user.writesTo("tasks")[0].values).toMatchObject({ due_date: null, due_time: null, duration_minutes: null });
  });

  it("cambiar el dia no toca la hora ni la duracion, y la auditoria usa HH:MM (R6)", async () => {
    const before = task({ due_date: "2026-10-20", due_time: "14:30:00", duration_minutes: 45 });
    const after = task({ due_date: "2026-10-27", due_time: "14:30:00", duration_minutes: 45, updated_at: "2026-10-02T10:00:00.000000+00:00" });
    const { ctx, user } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } });
    await updateTaskCore(ctx, T1, { due_date: "2026-10-27" });
    expect(user.writesTo("tasks")[0].values).toEqual({ due_date: "2026-10-27" });
    expect(mocks.audit.mock.calls[0][0].changes).toEqual({ due_date: { old: "2026-10-20", new: "2026-10-27" } });
  });

  it("agregar una hora audita old y new (R6)", async () => {
    const before = task({ due_date: "2026-10-20" });
    const after = task({ due_date: "2026-10-20", due_time: "14:30:00", duration_minutes: 45, updated_at: "2026-10-02T10:00:00.000000+00:00" });
    const { ctx } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } });
    await updateTaskCore(ctx, T1, { due_time: "14:30", duration_minutes: 45 });
    expect(mocks.audit.mock.calls[0][0].changes).toEqual({ due_time: { old: null, new: "14:30" }, duration_minutes: { old: null, new: 45 } });
  });

  it("cambia y audita solo lo que cambio (con old y new)", async () => {
    const before = task();
    const after = task({ title: "Enviar propuesta v2", priority: "high", updated_at: "2026-10-02T10:00:00.000000+00:00" });
    const { ctx } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } });
    const r = await updateTaskCore(ctx, T1, { title: "Enviar propuesta v2", priority: "high" });
    expect(r.ok).toBe(true);
    const call = mocks.audit.mock.calls[0][0];
    expect(call).toMatchObject({ entityType: "task", action: "task.updated", entityId: T1, performedBy: ME });
    expect(Object.keys(call.changes).sort()).toEqual(["priority", "title"]);
    expect(call.changes.priority).toEqual({ old: "normal", new: "high" });
  });

  it("reabrir una tarea completada se audita como task.reopened", async () => {
    const before = task({ status: "completed", completed_at: "2026-10-05T00:00:00Z" });
    const after = task({ status: "pending", completed_at: null });
    const { ctx } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } });
    await updateTaskCore(ctx, T1, { status: "pending" });
    expect(mocks.audit.mock.calls[0][0].action).toBe("task.reopened");
  });

  it("no audita un guardado que no cambia nada", async () => {
    const same = task();
    const { ctx } = ctxWith({ "tasks:select": { data: [same] }, "tasks:update": { data: [same] } });
    await updateTaskCore(ctx, T1, { title: same.title });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("el proyecto se guarda con su clave normalizada", async () => {
    const { ctx, user } = ctxWith({ "tasks:select": { data: [task()] }, "tasks:update": { data: [task({ project: "Lanzamiento Q4", project_key: "lanzamiento q4" })] } });
    await updateTaskCore(ctx, T1, { project: " Lanzamiento   Q4 " });
    expect(user.writesTo("tasks")[0].values).toMatchObject({ project: "Lanzamiento Q4", project_key: "lanzamiento q4" });
  });

  it("una tarea bloqueada no puede pasar a vencer antes que su bloqueante: se rechaza y no se escribe", async () => {
    const blocked = task({ id: T2, due_date: "2026-10-20", blocked_by: [{ task_id: T1, gap_days: 5 }] });
    const service = fakeDb({
      "workspace_members:select": { data: [{ user_id: ME }] },
      "tasks:select": { data: [{ id: T1, due_date: "2026-10-15" }] },
    });
    const { ctx, user } = ctxWith({ "tasks:select": { data: [blocked] } }, {}, service);
    const r = await updateTaskCore(ctx, T2, { due_date: "2026-10-10" });
    expect(r).toMatchObject({ ok: false, code: "date_before_blocker" });
    expect(user.writes()).toHaveLength(0);
    expect(service.writes()).toHaveLength(0);
  });

  it("al cambiar el vencimiento de una bloqueada, recalcula gap_days", async () => {
    const blocked = task({ id: T2, due_date: "2026-10-20", blocked_by: [{ task_id: T1, gap_days: 5 }] });
    const service = fakeDb({
      "workspace_members:select": { data: [{ user_id: ME }] },
      "tasks:select": { data: [{ id: T1, due_date: "2026-10-15" }] },
      "tasks:update": { data: [blocked] },
    });
    const { ctx, user } = ctxWith({ "tasks:select": { data: [blocked] }, "tasks:update": { data: [{ ...blocked, due_date: "2026-10-25" }] } }, {}, service);
    const r = await updateTaskCore(ctx, T2, { due_date: "2026-10-25" });
    expect(r.ok).toBe(true);
    expect(user.writesTo("tasks")).toHaveLength(1);
    expect(service.writesTo("tasks")[0].values).toEqual({ blocked_by: [{ task_id: T1, gap_days: 10 }] });
  });

  it("un seguidor que no es miembro se rechaza", async () => {
    const { ctx, user } = ctxWith({ "tasks:select": { data: [task()] } }, {}, fakeDb({ "workspace_members:select": { data: [{ user_id: ME }] } }));
    const r = await updateTaskCore(ctx, T1, { follower_ids: [OUTSIDER] });
    expect(r).toMatchObject({ ok: false, code: "validation", error: "Los seguidores tienen que ser parte del equipo." });
    expect(user.writes()).toHaveLength(0);
  });
});

describe("completar con corrimientos (F4, F8)", () => {
  // A (vence 10) bloquea a B (vence 11, gap 1). Hoy en Costa Rica es 2026-10-13 (se fija el reloj).
  const A = { id: T1, title: "A", status: "pending", due_date: "2026-10-10", start_date: null, completed_at: null, blocked_by: [], owner_id: ME, follower_ids: [], updated_at: "2026-10-01T00:00:00.111111+00:00" };
  const B = { id: T2, title: "B", status: "pending", due_date: "2026-10-11", start_date: null, completed_at: null, blocked_by: [{ task_id: T1, gap_days: 1 }], owner_id: OTHER, follower_ids: [], updated_at: "2026-10-01T00:00:00.222222+00:00" };

  // La regla de fechas es del sistema (R10): las dependientes salen de `task_shift_context`, no de lo que la persona ve.
  const ctxRow = (t: typeof B, over: Record<string, unknown> = {}) => ({ ...t, in_tree: true, due_time: null, duration_minutes: null, visible: true, ...over });
  const handlers = (extra: Record<string, unknown> = {}) => ({
    "tasks:select": (call: DbCall) => (has(call, "eq", "id") ? { data: [A] } : { data: [] }),
    ...extra,
  });
  const contextRpc = (tasks: unknown[] = [ctxRow(B)]) => ({ task_shift_context: { data: { ok: true, tasks } } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
  });

  it("planCompletion arma el plan con titulos y el updated_at tal cual", async () => {
    const { ctx } = ctxWith(handlers(), contextRpc());
    const r = await planCompletionCore(ctx, T1);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.completedOn).toBe("2026-10-13");
    expect(r.data.shifts).toEqual([
      expect.objectContaining({ taskId: T2, title: "B", fromDue: "2026-10-11", toDue: "2026-10-14", days: 3, blockerTitle: "A" }),
    ]);
    expect(r.data.expected).toEqual([
      { task_id: T1, updated_at: A.updated_at },
      { task_id: T2, updated_at: B.updated_at },
    ]);
  });

  it("una tarea que no se ve da el error de permiso", async () => {
    const { ctx } = ctxWith({ "tasks:select": { data: [] } });
    vi.useRealTimers();
    expect(await planCompletionCore(ctx, T1)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("completeTask(applyShifts=true) manda a la RPC las fechas nuevas y el expected; devuelve a quien se movio", async () => {
    const { ctx, user } = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { data: { ok: true, shifted: [{ task_id: T2, from_due: "2026-10-11", to_due: "2026-10-14" }] } } });
    const r = await completeTaskCore(ctx, T1, true);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(user.rpcCalls.find((c) => c.name === "complete_task_with_shifts")).toEqual({
      name: "complete_task_with_shifts",
      args: {
        p_task_id: T1,
        p_shifts: [{ task_id: T2, due_date: "2026-10-14" }],
        p_expected: [{ task_id: T1, updated_at: A.updated_at }, { task_id: T2, updated_at: B.updated_at }],
      },
    });
    if (r.ok) {
      expect(r.data.unblocked).toEqual([{ task_id: T2, title: "B", owner_id: OTHER }]);
      expect(r.data.shifted).toHaveLength(1);
    }
  });

  it("completeTask(applyShifts=false) manda p_shifts vacio y solo el expected de la tarea", async () => {
    const { ctx, user } = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { data: { ok: true, shifted: [] } } });
    const r = await completeTaskCore(ctx, T1, false);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    const args = user.rpcCalls.find((c) => c.name === "complete_task_with_shifts")!.args as { p_shifts: unknown[]; p_expected: unknown[] };
    expect(args.p_shifts).toEqual([]);
    expect(args.p_expected).toEqual([{ task_id: T1, updated_at: A.updated_at }]);
  });

  it("si la RPC dice stale, devuelve el codigo stale (la pantalla recalcula)", async () => {
    const { ctx } = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { data: { ok: false, error: "stale", task_id: T2 } } });
    const r = await completeTaskCore(ctx, T1, true, [{ task_id: T1, updated_at: "viejo" }]);
    vi.useRealTimers();
    expect(r).toMatchObject({ ok: false, code: "stale" });
  });

  it("errores de la RPC con mensajes en castellano; un fallo de red no lanza", async () => {
    const forbidden = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { data: { ok: false, error: "forbidden" } } });
    expect(await completeTaskCore(forbidden.ctx, T1, true)).toMatchObject({ ok: false, code: "forbidden" });
    const already = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { data: { ok: false, error: "already_completed" } } });
    expect(await completeTaskCore(already.ctx, T1, true)).toMatchObject({ ok: false, code: "conflict" });
    const down = ctxWith(handlers(), { ...contextRpc(), complete_task_with_shifts: { error: { message: "network" } } });
    expect(await completeTaskCore(down.ctx, T1, true)).toMatchObject({ ok: false, code: "server" });
    vi.useRealTimers();
  });

  it("sin plan (nadie depende) completa directo", async () => {
    const { ctx, user } = ctxWith(
      { "tasks:select": (call: DbCall) => (has(call, "eq", "id") ? { data: [A] } : { data: [] }) },
      { ...contextRpc([]), complete_task_with_shifts: { data: { ok: true, shifted: [] } } },
    );
    const r = await completeTaskCore(ctx, T1, true);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect((user.rpcCalls.find((c) => c.name === "complete_task_with_shifts")!.args as { p_shifts: unknown[] }).p_shifts).toEqual([]);
  });
});

describe("la regla de fechas es del sistema, no de lo que la persona ve (R10)", () => {
  const A = { id: T1, title: "A", status: "pending", due_date: "2026-10-10", start_date: null, completed_at: null, blocked_by: [], owner_id: ME, follower_ids: [], updated_at: "ua" };
  const mkCtx = (over: Record<string, unknown>) => ({ due_time: "09:30", duration_minutes: 45, in_tree: true, start_date: null, completed_at: null, status: "pending", follower_ids: [], ...over });
  // B (de OTRA persona) depende de A; C (tambien ajena) depende de B. Quien completa A solo ve a B.
  const B = mkCtx({ id: T2, title: "B visible", due_date: "2026-10-11", blocked_by: [{ task_id: T1, gap_days: 1 }], owner_id: OTHER, visible: true, updated_at: "ub" });
  const C = mkCtx({ id: T3, title: "C secreta", due_date: "2026-10-12", blocked_by: [{ task_id: T2, gap_days: 1 }], owner_id: OTHER, follower_ids: ["55555555-5555-4555-8555-555555555555"], visible: false, updated_at: "uc" });
  const hiddenC = { ...C, title: null };
  const rootOnly = { "tasks:select": (call: DbCall) => (has(call, "eq", "id") ? { data: [A] } : { data: [] }) };
  const rpc = (tasks: unknown[]) => ({ task_shift_context: { data: { ok: true, tasks } } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
  });

  it("el plan mueve tambien las dependientes que no se ven, sin titulo ni datos, y las cuenta aparte", async () => {
    const { ctx } = ctxWith(rootOnly, rpc([B, hiddenC]));
    const r = await planCompletionCore(ctx, T1);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.shifts.map((x) => [x.taskId, x.toDue, x.visible, x.title])).toEqual([
      [T2, "2026-10-14", true, "B visible"],
      [T3, "2026-10-15", false, ""],
    ]);
    expect(r.data.hiddenShifts).toBe(1);
    expect(r.data.expected).toEqual([{ task_id: T1, updated_at: "ua" }, { task_id: T2, updated_at: "ub" }, { task_id: T3, updated_at: "uc" }]);
    expect(JSON.stringify(r.data)).not.toContain("C secreta");
  });

  it("el plan es el MISMO (mismas fechas) lo calcule quien ve todo o quien no ve a las ajenas", async () => {
    const seeAll = ctxWith(rootOnly, rpc([B, { ...C, visible: true, title: "C secreta" }]));
    const seeSome = ctxWith(rootOnly, rpc([B, hiddenC]));
    const a = await planCompletionCore(seeAll.ctx, T1);
    const b = await planCompletionCore(seeSome.ctx, T1);
    vi.useRealTimers();
    const dates = (r: typeof a) => (r.ok ? r.data.shifts.map(({ taskId, fromDue, toDue, fromStart, toStart, days, blockerId }) => ({ taskId, fromDue, toDue, fromStart, toStart, days, blockerId })) : null);
    expect(dates(a)).not.toBeNull();
    expect(dates(b)).toEqual(dates(a));
  });

  it("completar manda a la RPC TODOS los corrimientos y devuelve solo lo que quien completa ve", async () => {
    const { ctx, user } = ctxWith(rootOnly, {
      ...rpc([B, hiddenC]),
      complete_task_with_shifts: { data: { ok: true, shifted: [{ task_id: T2, from_due: "2026-10-11", to_due: "2026-10-14" }, { task_id: T3, from_due: "2026-10-12", to_due: "2026-10-15" }] } },
    });
    const r = await completeTaskCore(ctx, T1, true);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    const sent = user.rpcCalls.find((c) => c.name === "complete_task_with_shifts")!.args as { p_shifts: Array<{ task_id: string }> };
    expect(sent.p_shifts.map((x) => x.task_id)).toEqual([T2, T3]);
    if (!r.ok) return;
    expect(r.data.shifted.map((x) => x.task_id)).toEqual([T2]);
    expect(r.data.hiddenShifted).toBe(1);
    expect(r.data.movedRows.map((x) => x.id)).toEqual([T2]);
    expect(JSON.stringify(r.data)).not.toContain("C secreta");
    expect(JSON.stringify(r.data)).not.toContain(T3);
  });

  it("avisa task_date_moved a los duenos de CADA tarea movida (tambien las que quien completa no ve), nunca al actor", async () => {
    const FOLLOWER = "55555555-5555-4555-8555-555555555555";
    const service = fakeDb({
      "workspace_members:select": { data: [] },
      "notifications:select": { data: [] },
      "tasks:select": { data: [{ id: T2, title: "B visible" }, { id: T3, title: "C secreta" }] },
    });
    const { ctx } = ctxWith(
      rootOnly,
      { ...rpc([B, { ...hiddenC, follower_ids: [FOLLOWER] }]), complete_task_with_shifts: { data: { ok: true, shifted: [{ task_id: T2, from_due: "2026-10-11", to_due: "2026-10-14" }, { task_id: T3, from_due: "2026-10-12", to_due: "2026-10-15" }] } } },
      service,
    );
    await completeTaskCore({ ...ctx, actorName: "María" }, T1, true);
    vi.useRealTimers();
    const notices = service.writesTo("notifications").map((w) => w.values as { type: string; recipient_id: string; entity_id: string; title: string });
    const moved = notices.filter((n) => n.type === "task_date_moved");
    expect(moved.map((n) => [n.entity_id, n.recipient_id]).sort()).toEqual([[T2, OTHER], [T3, FOLLOWER], [T3, OTHER]].sort());
    expect(moved.find((n) => n.entity_id === T3)?.title).toContain("C secreta");
    expect(notices.every((n) => n.recipient_id !== ME)).toBe(true);
  });

  it("libera tambien a las dependientes ajenas: task_unblocked a su responsable", async () => {
    const Bsolo = mkCtx({ id: T2, due_date: "2026-10-11", blocked_by: [{ task_id: T1, gap_days: 1 }], owner_id: OTHER, visible: false, title: null, updated_at: "ub" });
    const service = fakeDb({ "workspace_members:select": { data: [] }, "notifications:select": { data: [] }, "tasks:select": { data: [{ id: T2, title: "B ajena" }] } });
    const { ctx } = ctxWith(rootOnly, { ...rpc([Bsolo]), complete_task_with_shifts: { data: { ok: true, shifted: [] } } }, service);
    const r = await completeTaskCore(ctx, T1, false);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.unblocked).toEqual([]);
    const freed = service.writesTo("notifications").map((w) => w.values as { type: string; recipient_id: string }).filter((n) => n.type === "task_unblocked");
    expect(freed).toEqual([expect.objectContaining({ recipient_id: OTHER })]);
  });

  it("si la funcion de contexto responde que no se puede completar, es un error de permiso (no se arma ningun plan)", async () => {
    const { ctx } = ctxWith(rootOnly, { task_shift_context: { data: { ok: false, error: "forbidden" } } });
    const r = await planCompletionCore(ctx, T1);
    vi.useRealTimers();
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("dependencias y borrado (F5, F6)", () => {
  it("setTaskBlockers traduce cada error de la RPC", async () => {
    const cases: Array<[string, string]> = [["cycle", "cycle"], ["date_before_blocker", "date_before_blocker"], ["too_many", "validation"], ["forbidden", "forbidden"]];
    for (const [rpcError, code] of cases) {
      const { ctx } = ctxWith({}, { set_task_blockers: { data: { ok: false, error: rpcError } } });
      expect(await setTaskBlockersCore(ctx, T1, [T2])).toMatchObject({ ok: false, code });
    }
    const { ctx } = ctxWith({}, { set_task_blockers: { data: { ok: true, blocked_by: [{ task_id: T2, gap_days: 3 }] } } });
    expect(await setTaskBlockersCore(ctx, T1, [T2])).toEqual({ ok: true, data: [{ task_id: T2, gap_days: 3 }] });
  });

  it("setTaskBlockers valida los ids antes de llamar", async () => {
    const { ctx, user } = ctxWith({});
    expect(await setTaskBlockersCore(ctx, T1, ["no-uuid"])).toMatchObject({ ok: false, code: "validation" });
    expect(user.rpcCalls).toHaveLength(0);
  });

  it("deleteTask usa la RPC y no escribe la tabla directo", async () => {
    const { ctx, user } = ctxWith({}, { delete_task: { data: { ok: true, unlinked_from: 2 } } });
    expect(await deleteTaskCore(ctx, T1)).toEqual({ ok: true, data: { unlinkedFrom: 2 } });
    expect(user.writes()).toHaveLength(0);
    const denied = ctxWith({}, { delete_task: { data: { ok: false, error: "forbidden" } } });
    expect(await deleteTaskCore(denied.ctx, T1)).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("avisos desde el nucleo (F17)", () => {
  const OTHER2 = "44444444-4444-4444-8444-444444444444";

  it("crear con otro responsable: task_assigned para el, con el nombre de quien actua y la tarea como destino", async () => {
    const service = fakeDb({ "workspace_members:select": { data: [{ user_id: ME }, { user_id: OTHER }] } });
    const { ctx } = ctxWith({ "tasks:insert": { data: [task({ owner_id: OTHER })] } }, {}, service);
    await createTaskCore({ ...ctx, actorName: "María" }, { title: "Enviar propuesta", owner_id: OTHER });
    const notices = service.writesTo("notifications");
    expect(notices).toHaveLength(1);
    expect(notices[0].values).toMatchObject({ type: "task_assigned", recipient_id: OTHER, entity_type: "task", entity_id: T1, workspace_id: WS, title: "María te asignó «Enviar propuesta»" });
  });

  it("crearse una tarea a si mismo no avisa a nadie", async () => {
    const service = fakeDb({ "workspace_members:select": { data: [{ user_id: ME }] } });
    const { ctx } = ctxWith({ "tasks:insert": { data: [task({ owner_id: ME })] } }, {}, service);
    await createTaskCore(ctx, { title: "x" });
    expect(service.writesTo("notifications")).toHaveLength(0);
  });

  it("editar el estado avisa a los seguidores (no al actor) y un fallo al avisar no rompe la edicion", async () => {
    const before = task({ owner_id: ME, follower_ids: [OTHER, OTHER2] });
    const after = task({ owner_id: ME, follower_ids: [OTHER, OTHER2], status: "in_progress" });
    const service = fakeDb({
      "workspace_members:select": { data: [{ user_id: ME }, { user_id: OTHER }, { user_id: OTHER2 }] },
      "notifications:select": { data: [] },
      "notifications:insert": { error: { message: "boom" } },
    });
    const { ctx } = ctxWith({ "tasks:select": { data: [before] }, "tasks:update": { data: [after] } }, {}, service);
    const r = await updateTaskCore(ctx, T1, { status: "in_progress" });
    expect(r.ok).toBe(true);
    expect(service.writesTo("notifications").map((w) => (w.values as { recipient_id: string }).recipient_id).sort()).toEqual([OTHER, OTHER2].sort());
    expect(service.writesTo("notifications").every((w) => (w.values as { recipient_id: string }).recipient_id !== ME)).toBe(true);
  });

  it("completar con fechas movidas avisa: libre, fecha movida y lo que paso con la tarea", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
    const A = { id: T1, title: "A", status: "pending", due_date: "2026-10-10", start_date: null, completed_at: null, blocked_by: [], owner_id: ME, follower_ids: [OTHER2], updated_at: "u1" };
    const B = { id: T2, title: "B", status: "pending", due_date: "2026-10-11", start_date: null, completed_at: null, blocked_by: [{ task_id: T1, gap_days: 1 }], owner_id: OTHER, follower_ids: [], updated_at: "u2" };
    const service = fakeDb({ "workspace_members:select": { data: [] }, "notifications:select": { data: [] } });
    const { ctx } = ctxWith(
      {
        "tasks:select": (call: DbCall) => (has(call, "eq", "id") ? { data: [A] } : { data: [] }),
      },
      { task_shift_context: { data: { ok: true, tasks: [{ ...B, in_tree: true, due_time: null, duration_minutes: null, visible: true }] } }, complete_task_with_shifts: { data: { ok: true, shifted: [{ task_id: T2, from_due: "2026-10-11", to_due: "2026-10-14" }] } } },
      service,
    );
    const r = await completeTaskCore({ ...ctx, actorName: "María" }, T1, true);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    const rows = service.writesTo("notifications").map((w) => w.values as { type: string; recipient_id: string; entity_id: string });
    expect(rows.filter((n) => n.type === "task_unblocked").map((n) => [n.recipient_id, n.entity_id])).toEqual([[OTHER, T2]]);
    expect(rows.filter((n) => n.type === "task_date_moved").map((n) => [n.recipient_id, n.entity_id])).toEqual([[OTHER, T2]]);
    expect(rows.filter((n) => n.type === "task_changed").map((n) => [n.recipient_id, n.entity_id])).toEqual([[OTHER2, T1]]);
    expect(rows.every((n) => n.recipient_id !== ME)).toBe(true);
  });
});
