import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { completeTaskNode } from "./complete-task";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";

const ctx = (variables: Record<string, unknown>, over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t", flowId: "flow-1", channelId: "", contactId: "c-1", memberUserId: null, conversationId: "", workspaceId: WS, incomingMessage: {}, variables, ...over,
});

function world() {
  return memoryDb({
    workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
    workspace_members: [{ workspace_id: WS, user_id: "u-1", role: "member" }],
    tasks: [
      { id: "t1", workspace_id: WS, title: "Cobrar 1", status: "pending", source: "flow", source_ref: "payment:pay-1", deleted_at: null, blocked_by: [], follower_ids: [], owner_id: "u-1", contact_id: "c-1" },
      { id: "t2", workspace_id: WS, title: "Cobrar 2", status: "pending", source: "flow", source_ref: "payment:pay-2", deleted_at: null, blocked_by: [], follower_ids: [], owner_id: "u-1", contact_id: null },
      { id: "t3", workspace_id: WS, title: "Manual", status: "pending", source: "manual", source_ref: null, deleted_at: null, blocked_by: [], follower_ids: [], owner_id: "u-1", contact_id: null },
    ],
    notifications: [], audit_log: [], automation_events: [],
  });
}

const run = (db: ReturnType<typeof world>, data: Parameters<typeof completeTaskNode.execute>[0]["data"], context = ctx({ payment: { id: "pay-1" } })) =>
  completeTaskNode.execute({ supabase: db.client, node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never, data, context, sessionId: "s1", runtime: { executeFlow: async () => {} } } as never);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("nodo «Completar tarea» (R4)", () => {
  it("esta registrado como accion que no necesita contacto", () => {
    expect(completeTaskNode.type).toBe("complete_task");
    expect(completeTaskNode.needsContact).toBe(false);
    expect(completeTaskNode.aliases).toEqual([{ nodeType: "action", actionType: "complete_task" }]);
  });

  it("completa la tarea de la clave con variables resueltas, y solo esa", async () => {
    const db = world();
    await run(db, { sourceKey: "payment:{{payment.id}}" });
    expect(db.rows("tasks").map((t) => t.status)).toEqual(["completed", "pending", "pending"]);
  });

  it("funciona sin contacto en el flujo", async () => {
    const db = world();
    await run(db, { sourceKey: "payment:{{payment.id}}" }, ctx({ payment: { id: "pay-2" } }, { contactId: null }));
    expect(db.rows("tasks").map((t) => t.status)).toEqual(["pending", "completed", "pending"]);
  });

  it("sin clave, o con una variable que no resuelve, no completa NADA (no cierra una manual por error)", async () => {
    const db = world();
    await run(db, {});
    await run(db, { sourceKey: "   " });
    await run(db, { sourceKey: "payment:{{payment.id}}" }, ctx({}));
    await run(db, { sourceKey: "payment:{{payment.id}}" }, ctx({ payment: { id: "" } }));
    expect(db.rows("tasks").every((t) => t.status === "pending")).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it("una tarea que ya estaba completada no se toca (si una persona ya la cerro, no pasa nada)", async () => {
    const db = world();
    db.rows("tasks")[0].status = "completed";
    await run(db, { sourceKey: "payment:{{payment.id}}" });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("NUNCA lanza", async () => {
    const broken = { from: () => { throw new Error("la base se cayo"); } };
    await expect(completeTaskNode.execute({ supabase: broken, node: { id: "n1" }, data: { sourceKey: "k" }, context: ctx({}), sessionId: "s", runtime: {} } as never)).resolves.toBeUndefined();
  });
});
