/**
 * F7: cada mutacion de una tarea deja su entrada en `audit_log` con `changes {old,new}`.
 * Crear y editar las escribe el nucleo (aca); completar, mover fechas, cambiar dependencias y
 * borrar las escriben las RPC en la base (las prueba `scripts/verify-tasks.mjs`).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: mocks.audit }));

import { createTaskCore, updateTaskCore, type TaskCtx } from "./core";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row = (over: Record<string, unknown> = {}) => ({
  id: T1, workspace_id: "ws1", title: "T", description: null, status: "pending", priority: "normal", start_date: null, due_date: null,
  completed_at: null, owner_id: ME, follower_ids: [], project: null, project_key: null, blocked_by: [], contact_id: null, conversation_id: null,
  source: "manual", source_ref: null, position: 0, created_by: ME, created_at: "x", updated_at: "y", deleted_at: null, ...over,
});

function ctx(handlers: Parameters<typeof fakeDb>[0]): TaskCtx {
  return {
    supabase: fakeDb(handlers).client,
    service: fakeDb({ "workspace_members:select": { data: [{ user_id: ME }, { user_id: OTHER }] } }).client,
    workspaceId: "ws1", userId: ME, timeZone: "UTC",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("auditoria de tareas (F7)", () => {
  it("crear: task.created con los campos y quien la creo", async () => {
    await createTaskCore(ctx({ "tasks:insert": { data: [row({ title: "Nueva", due_date: "2026-10-20" })] } }), { title: "Nueva", due_date: "2026-10-20" });
    const a = mocks.audit.mock.calls[0][0];
    expect(a).toMatchObject({ entityType: "task", entityId: T1, action: "task.created", performedBy: ME, workspaceId: "ws1" });
    expect(a.changes.due_date).toEqual({ old: null, new: "2026-10-20" });
  });

  it.each([
    ["estado", { status: "in_progress" }, { status: "in_progress" }, "status", "pending", "in_progress"],
    ["responsable", { owner_id: OTHER }, { owner_id: OTHER }, "owner_id", ME, OTHER],
    ["fecha", { due_date: "2026-11-01" }, { due_date: "2026-11-01" }, "due_date", null, "2026-11-01"],
    ["proyecto", { project: "Q4" }, { project: "Q4", project_key: "q4" }, "project", null, "Q4"],
    ["prioridad", { priority: "urgent" }, { priority: "urgent" }, "priority", "normal", "urgent"],
  ])("editar %s: task.updated con old y new", async (_n, patch, afterOver, field, oldV, newV) => {
    const c = ctx({ "tasks:select": { data: [row()] }, "tasks:update": { data: [row(afterOver as Record<string, unknown>)] } });
    await updateTaskCore(c, T1, patch);
    const a = mocks.audit.mock.calls[0][0];
    expect(a.action).toBe("task.updated");
    expect(a.changes[field as string]).toEqual({ old: oldV, new: newV });
  });

  it("agregar seguidores queda como una lista legible (ordenada)", async () => {
    const c = ctx({ "tasks:select": { data: [row()] }, "tasks:update": { data: [row({ follower_ids: [OTHER] })] } });
    await updateTaskCore(c, T1, { follower_ids: [OTHER] });
    expect(mocks.audit.mock.calls[0][0].changes.follower_ids).toEqual({ old: null, new: OTHER });
  });

  it("completar, mover fechas, dependencias y borrar las audita la RPC en la misma transaccion", () => {
    const sql = readFileSync("supabase/migrations/00197_tasks_functions.sql", "utf8");
    for (const action of ["task.completed", "task.date_shifted", "task.blockers_changed", "task.deleted"]) {
      expect(sql, action).toContain(`'${action}'`);
    }
    expect(sql).toContain("audit_log_select_tasks");
  });

  it("las acciones de tareas existen en el tipo AuditAction y en el de entidades", () => {
    const types = readFileSync("lib/types/database.ts", "utf8");
    for (const a of ["task.created", "task.updated", "task.reopened", "task.completed", "task.date_shifted", "task.blockers_changed", "task.deleted"]) {
      expect(types).toContain(`"${a}"`);
    }
    expect(types).toMatch(/\|\s*"task";/);
  });
});
