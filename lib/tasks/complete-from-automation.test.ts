import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { completeTasksFromAutomation } from "./complete-from-automation";

const WS = "ws-1";
const ANA = "u-ana";
const BETO = "u-beto";

function world(tasks: Array<Record<string, unknown>>) {
  const base = { workspace_id: WS, status: "pending", deleted_at: null, blocked_by: [], follower_ids: [], owner_id: null, contact_id: null, created_by: null, priority: "normal", title: "t", source: "flow" };
  return memoryDb({
    workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
    workspace_members: [{ workspace_id: WS, user_id: ANA, role: "member" }, { workspace_id: WS, user_id: BETO, role: "member" }],
    tasks: tasks.map((t, i) => ({ id: `t${i + 1}`, updated_at: "2026-10-01T00:00:00Z", completed_at: null, ...base, ...t })),
    notifications: [], audit_log: [], automation_events: [],
  });
}
const run = (db: ReturnType<typeof world>, sourceRef: string) =>
  completeTasksFromAutomation(db.client, { workspaceId: WS, sourceRef, actor: { label: "Automatización", flowId: "f1", runId: "s1", nodeId: "n1" } });
const status = (db: ReturnType<typeof world>, id: string) => db.rows("tasks").find((t) => t.id === id)?.status;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("completar tareas desde una automatizacion (R4)", () => {
  it("completa las abiertas con esa clave y ninguna otra", async () => {
    const db = world([
      { source_ref: "payment:p1" },
      { source_ref: "payment:p1", status: "in_progress" },
      { source_ref: "payment:p2" },
      { source_ref: null },
      { source_ref: "payment:p1", workspace_id: "otro-ws" },
    ]);
    const res = await run(db, "payment:p1");
    expect(res).toEqual({ ok: true, completed: ["t1", "t2"] });
    expect(["t1", "t2", "t3", "t4", "t5"].map((id) => status(db, id))).toEqual(["completed", "completed", "pending", "pending", "pending"]);
  });

  it("sin tarea que coincida no hace nada y no falla", async () => {
    const db = world([{ source_ref: "payment:p2" }]);
    expect(await run(db, "payment:p1")).toEqual({ ok: true, completed: [] });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("NUNCA completa sin una clave: una tarea manual sin source_ref no se toca", async () => {
    const db = world([{ source_ref: null, source: "manual" }, { source_ref: "", source: "manual" }]);
    expect(await run(db, "")).toEqual({ ok: true, completed: [] });
    expect(await run(db, "   ")).toEqual({ ok: true, completed: [] });
    expect(db.rows("tasks").every((t) => t.status === "pending")).toBe(true);
  });

  it("no toca las borradas ni las ya completadas", async () => {
    const db = world([{ source_ref: "k", deleted_at: "2026-10-02T00:00:00Z" }, { source_ref: "k", status: "completed" }]);
    expect(await run(db, "k")).toEqual({ ok: true, completed: [] });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("deja el historial con el sistema como actor", async () => {
    const db = world([{ source_ref: "k" }]);
    await run(db, "k");
    expect(db.rows("audit_log")).toHaveLength(1);
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "task", entity_id: "t1", action: "task.completed", actor_type: "system" });
    expect(db.rows("audit_log")[0].metadata).toMatchObject({ origin: "flow", source_ref: "k", flow_id: "f1", node_id: "n1" });
  });

  it("avisa al responsable y a los seguidores (nunca al actor, que es el sistema)", async () => {
    const db = world([{ source_ref: "k", owner_id: ANA, follower_ids: [BETO], title: "Cobrar" }]);
    await run(db, "k");
    const notices = db.rows("notifications").filter((n) => n.type === "task_changed");
    expect(notices.map((n) => n.recipient_id).sort()).toEqual([ANA, BETO]);
  });

  it("libera a las dependientes cuyos bloqueantes quedaron todos completados, y avisa a su responsable", async () => {
    const db = world([
      { id: "A", source_ref: "k" },
      { id: "B", owner_id: BETO, title: "Despues", blocked_by: [{ task_id: "A", gap_days: 1 }] },
      { id: "C", owner_id: ANA, title: "Espera dos", blocked_by: [{ task_id: "A", gap_days: 1 }, { task_id: "X", gap_days: 1 }] },
      { id: "X", status: "pending", source_ref: null },
    ]);
    await run(db, "k");
    const freed = db.rows("notifications").filter((n) => n.type === "task_unblocked");
    expect(freed.map((n) => n.recipient_id)).toEqual([BETO]);
  });

  it("NO mueve fechas de las dependientes", async () => {
    const db = world([
      { id: "A", source_ref: "k", due_date: "2026-10-01" },
      { id: "B", due_date: "2026-10-02", blocked_by: [{ task_id: "A", gap_days: 1 }] },
    ]);
    await run(db, "k");
    expect(db.rows("tasks").find((t) => t.id === "B")?.due_date).toBe("2026-10-02");
  });

  it("emite el evento task_completed como una persona (con contacto, sobre el contacto)", async () => {
    const db = world([{ source_ref: "k", contact_id: "c-1" }]);
    await run(db, "k");
    expect(db.rows("automation_events")).toHaveLength(1);
    expect(db.rows("automation_events")[0]).toMatchObject({ event_type: "task_completed", contact_id: "c-1" });
  });

  it("es idempotente: la segunda vez no encuentra nada abierto", async () => {
    const db = world([{ source_ref: "k" }]);
    expect((await run(db, "k"))).toEqual({ ok: true, completed: ["t1"] });
    expect((await run(db, "k"))).toEqual({ ok: true, completed: [] });
    expect(db.rows("audit_log")).toHaveLength(1);
  });

  it("NUNCA lanza: una base rota devuelve ok:false", async () => {
    const broken = { from: () => { throw new Error("la base se cayo"); } };
    const res = await completeTasksFromAutomation(broken as never, { workspaceId: WS, sourceRef: "k", actor: { label: "x" } });
    expect(res.ok).toBe(false);
  });
});
