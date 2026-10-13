import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { createTaskNode, resolveDue, resolveOwner, stripUnresolved, type CreateTaskNodeData } from "./create-task";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";
const ANA = "u-ana";
const LIDER = "u-lider";
const ADMIN = "u-admin";

const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t", flowId: "flow-1", channelId: "", contactId: "c-1", memberUserId: null, conversationId: "cv-1", workspaceId: WS, incomingMessage: {},
  variables: { contact: { name: "Beto" }, answer: { motivo: "quiere precio" } }, ...over,
});

function world() {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      workspace_members: [
        { workspace_id: WS, user_id: ANA, role: "member" },
        { workspace_id: WS, user_id: LIDER, role: "member" },
        { workspace_id: WS, user_id: ADMIN, role: "admin" },
      ],
      contacts: [{ id: "c-1", workspace_id: WS }],
      conversations: [{ id: "cv-1", workspace_id: WS }],
      tasks: [], notifications: [], audit_log: [],
    },
    { unique: { tasks: (a, b) => a.workspace_id === b.workspace_id && a.source === b.source && a.source_ref === b.source_ref && a.source_ref != null && b.status !== "completed" && !b.deleted_at } },
  );
}

const run = (db: ReturnType<typeof world>, data: CreateTaskNodeData, context = ctx(), sessionId = "s1") =>
  createTaskNode.execute({ supabase: db.client, node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never, data, context, sessionId, runtime: { executeFlow: async () => {} } } as never);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("nodo «Crear tarea» (F22)", () => {
  it("no necesita contacto (sirve con y sin contacto)", () => {
    expect(createTaskNode.needsContact).toBe(false);
    expect(createTaskNode.type).toBe("create_task");
  });

  it("crea la tarea con titulo interpolado, vinculada al contacto y a la conversacion, con origen flow", async () => {
    const db = world();
    await run(db, { title: "Llamar a {{contact.name}} por {{answer.motivo}}", description: "Pidió info de {{contact.name}}", owner: "user", ownerId: ANA, project: "Ventas Q4", priority: "high", dueMode: "days", dueDays: 2 });
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
    expect(db.rows("tasks")[0]).toMatchObject({
      title: "Llamar a Beto por quiere precio", description: "Pidió info de Beto", owner_id: ANA, project: "Ventas Q4", priority: "high", due_date: "2026-10-15",
      contact_id: "c-1", conversation_id: "cv-1", source: "flow", source_ref: "flow-1:s1:n1",
    });
  });

  it("sin contacto: igual se crea, suelta", async () => {
    const db = world();
    await run(db, { title: "Revisar el reporte", owner: "member" }, ctx({ contactId: null, conversationId: "", memberUserId: LIDER }));
    vi.useRealTimers();
    expect(db.rows("tasks")[0]).toMatchObject({ owner_id: LIDER, contact_id: null, conversation_id: null });
  });

  it("responsable: persona fija, quien envio el reporte, o nadie", async () => {
    const db = world();
    await run(db, { title: "A", owner: "none" }, ctx(), "s-a");
    await run(db, { title: "B", owner: "member" }, ctx({ memberUserId: ANA }), "s-b");
    await run(db, { title: "C", owner: "user", ownerId: LIDER }, ctx(), "s-c");
    vi.useRealTimers();
    expect(db.rows("tasks").map((t) => t.owner_id)).toEqual([null, ANA, LIDER]);
    expect(db.rows("notifications").filter((n) => n.title === "«A» no tiene responsable")).toHaveLength(0);
  });

  it("un responsable que no es del equipo: queda sin responsable y se avisa a Owner/Admin", async () => {
    const db = world();
    await run(db, { title: "Tarea huérfana", owner: "user", ownerId: "u-de-otro-lado" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    expect(db.rows("notifications").filter((n) => n.recipient_id === ADMIN && n.type === "task_assigned")).toHaveLength(1);
  });

  it("seguidores: solo los que son del equipo", async () => {
    const db = world();
    await run(db, { title: "Con seguidores", followerIds: [ANA, "u-de-otro-lado", LIDER] });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].follower_ids).toEqual([ANA, LIDER]);
  });

  it("sin titulo (tambien despues de interpolar) no crea nada y lo advierte, sin lanzar", async () => {
    const db = world();
    await run(db, { title: "   " });
    await run(db, { title: "{{no.existe}}" }, ctx({ variables: {} }));
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it("NUNCA lanza: un error al crear no corta el flujo", async () => {
    const broken = { from: () => { throw new Error("la base se cayo"); } };
    await expect(createTaskNode.execute({ supabase: broken, node: { id: "n1" }, data: { title: "X" }, context: ctx(), sessionId: "s", runtime: {} } as never)).resolves.toBeUndefined();
    vi.useRealTimers();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[tareas]"), expect.anything());
  });

  it("IDEMPOTENTE: la misma ejecucion y el mismo nodo no crean dos tareas abiertas", async () => {
    const db = world();
    await run(db, { title: "Una sola vez" }, ctx(), "s-igual");
    await run(db, { title: "Una sola vez" }, ctx(), "s-igual");
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
  });

  it("otra ejecucion del mismo flujo si crea la suya", async () => {
    const db = world();
    await run(db, { title: "Cada vez" }, ctx(), "s-1");
    await run(db, { title: "Cada vez" }, ctx(), "s-2");
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(2);
  });

  it("audita como el sistema con el id del flujo", async () => {
    const db = world();
    await run(db, { title: "Auditada", owner: "user", ownerId: ANA });
    vi.useRealTimers();
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "task", action: "task.created", actor_type: "system" });
    expect(db.rows("audit_log")[0].metadata).toMatchObject({ flow_id: "flow-1", node_id: "n1", origin: "flow" });
  });
});

describe("variables sin resolver", () => {
  it("se sacan: no quedan {{...}} sueltos en el titulo", async () => {
    const db = world();
    await run(db, { title: "Llamar a {{contact.name}} {{no.existe}}" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].title).toBe("Llamar a Beto");
    expect(stripUnresolved("a {{x}} b {{y.z}}")).toBe("a  b ");
  });
});

describe("resolveDue / resolveOwner", () => {
  it("resolveDue: sin fecha, fecha fija valida, +N dias acotado", () => {
    expect(resolveDue({ dueMode: "none" }, "2026-10-13")).toBeNull();
    expect(resolveDue({}, "2026-10-13")).toBeNull();
    expect(resolveDue({ dueMode: "date", dueDate: "2026-11-01" }, "2026-10-13")).toBe("2026-11-01");
    expect(resolveDue({ dueMode: "date", dueDate: "mañana" }, "2026-10-13")).toBeNull();
    expect(resolveDue({ dueMode: "days", dueDays: 2 }, "2026-10-13")).toBe("2026-10-15");
    expect(resolveDue({ dueMode: "days", dueDays: 0 }, "2026-10-13")).toBe("2026-10-13");
    expect(resolveDue({ dueMode: "days", dueDays: -5 }, "2026-10-13")).toBe("2026-10-13");
    expect(resolveDue({ dueMode: "days", dueDays: 9999 }, "2026-10-13")).toBe("2027-10-13");
    expect(resolveDue({ dueMode: "days", dueDays: Number.NaN }, "2026-10-13")).toBeNull();
  });
  it("resolveOwner", () => {
    expect(resolveOwner({ owner: "none", ownerId: "x" }, "m")).toBeNull();
    expect(resolveOwner({ owner: "user", ownerId: "x" }, "m")).toBe("x");
    expect(resolveOwner({ owner: "user" }, "m")).toBeNull();
    expect(resolveOwner({ owner: "member" }, "m")).toBe("m");
    expect(resolveOwner({ owner: "member" }, null)).toBeNull();
    expect(resolveOwner({}, "m")).toBeNull();
  });
});
