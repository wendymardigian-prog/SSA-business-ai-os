import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { createTaskNode, resolveDue, resolveOwner, resolveSourceKey, saleIdOf, stripUnresolved, type CreateTaskNodeData } from "./create-task";
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

// ── Tareas × CRM (R3): responsable por venta o contacto, clave de origen ─────────────────────────────────────────────

const VENDEDOR = "u-vendedor";
const SETTER = "u-setter";

function worldCrm(over: { sale?: Record<string, unknown>; contact?: Record<string, unknown>; conversations?: Array<Record<string, unknown>> } = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      workspace_members: [
        { workspace_id: WS, user_id: VENDEDOR, role: "member" },
        { workspace_id: WS, user_id: SETTER, role: "member" },
        { workspace_id: WS, user_id: ANA, role: "member" },
        { workspace_id: WS, user_id: ADMIN, role: "admin" },
        { workspace_id: WS, user_id: "u-owner", role: "owner" },
      ],
      contacts: [{ id: "c-1", workspace_id: WS, vendedor_id: null, setter_id: null, ...over.contact }],
      conversations: over.conversations ?? [{ id: "cv-1", workspace_id: WS, contact_id: "c-1", assigned_to: null, deleted_at: null, last_message_at: "2026-10-01T00:00:00Z" }],
      sales: [{ id: "sale-1", workspace_id: WS, vendedor_id: VENDEDOR, setter_id: SETTER, ...over.sale }],
      tasks: [], notifications: [], audit_log: [],
    },
    { unique: { tasks: (a, b) => a.workspace_id === b.workspace_id && a.source === b.source && a.source_ref === b.source_ref && a.source_ref != null && b.status !== "completed" && !b.deleted_at } },
  );
}

const paymentCtx = (over: Partial<FlowExecutionContext> = {}) =>
  ctx({ variables: { event_sale_id: "sale-1", event_payment_id: "pay-1", sale: { id: "sale-1", product_name: "Mentoría" }, payment: { id: "pay-1", due_date: "12 de octubre de 2026", amount: "$300,00" }, contact: { first_name: "Ana" } }, ...over });

describe("responsable «Vendedor de la venta» (R3)", () => {
  it("el vendedor de la venta", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", owner: "seller" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(VENDEDOR);
  });
  it("sin vendedor, el setter", async () => {
    const db = worldCrm({ sale: { vendedor_id: null } });
    await run(db, { title: "Cobrar", owner: "seller" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(SETTER);
  });
  it("un vendedor que ya no es del equipo se saltea: va el setter", async () => {
    const db = worldCrm({ sale: { vendedor_id: "u-ex-equipo" } });
    await run(db, { title: "Cobrar", owner: "seller" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(SETTER);
  });
  it("sin vendedor ni setter: queda sin responsable y se avisa a CADA Owner/Admin, uno por uno", async () => {
    const db = worldCrm({ sale: { vendedor_id: null, setter_id: null } });
    await run(db, { title: "Cobrar", owner: "seller" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    const notices = db.rows("notifications").filter((n) => n.title === "«Cobrar» no tiene responsable");
    expect(notices.map((n) => n.recipient_id).sort()).toEqual([ADMIN, "u-owner"]);
    expect(notices.every((n) => typeof n.recipient_id === "string" && n.recipient_id)).toBe(true);
  });
  it("sin venta en el evento: queda sin responsable (y avisa)", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", owner: "seller" }, ctx({ variables: {} }));
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    expect(db.rows("notifications").filter((n) => n.type === "task_assigned")).toHaveLength(2);
  });
  it("saleIdOf lee event_sale_id o sale.id", () => {
    expect(saleIdOf({ event_sale_id: "s-1" })).toBe("s-1");
    expect(saleIdOf({ sale: { id: "s-2" } })).toBe("s-2");
    expect(saleIdOf({ event_sale_id: "  ", sale: { id: "s-3" } })).toBe("s-3");
    expect(saleIdOf({})).toBeNull();
  });
});

describe("responsable «Persona asignada al contacto» (R3)", () => {
  it("el vendedor del contacto", async () => {
    const db = worldCrm({ contact: { vendedor_id: VENDEDOR, setter_id: SETTER } });
    await run(db, { title: "T", owner: "contact_assigned" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(VENDEDOR);
  });
  it("sin vendedor, el setter", async () => {
    const db = worldCrm({ contact: { setter_id: SETTER } });
    await run(db, { title: "T", owner: "contact_assigned" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(SETTER);
  });
  it("sin ninguno de los dos, quien tiene asignada su conversacion mas reciente", async () => {
    const db = worldCrm({
      conversations: [
        { id: "cv-vieja", workspace_id: WS, contact_id: "c-1", assigned_to: SETTER, deleted_at: null, last_message_at: "2026-09-01T00:00:00Z" },
        { id: "cv-nueva", workspace_id: WS, contact_id: "c-1", assigned_to: ANA, deleted_at: null, last_message_at: "2026-10-10T00:00:00Z" },
        { id: "cv-sin", workspace_id: WS, contact_id: "c-1", assigned_to: null, deleted_at: null, last_message_at: "2026-10-12T00:00:00Z" },
      ],
    });
    await run(db, { title: "T", owner: "contact_assigned" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBe(ANA);
  });
  it("nadie asignado: sin responsable y se avisa", async () => {
    const db = worldCrm();
    await run(db, { title: "T", owner: "contact_assigned" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    expect(db.rows("notifications").filter((n) => n.type === "task_assigned")).toHaveLength(2);
  });
  it("sin contacto en el flujo: sin responsable", async () => {
    const db = worldCrm({ contact: { vendedor_id: VENDEDOR } });
    await run(db, { title: "T", owner: "contact_assigned" }, ctx({ contactId: null }));
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
  });
});

describe("clave de origen (R3)", () => {
  it("resolveSourceKey: resuelve variables, y no se usa si alguna falta o queda vacia", () => {
    expect(resolveSourceKey("payment:{{payment.id}}", { payment: { id: "pay-1" } })).toBe("payment:pay-1");
    expect(resolveSourceKey("  fija  ", {})).toBe("fija");
    expect(resolveSourceKey("", {})).toBeNull();
    expect(resolveSourceKey(undefined, {})).toBeNull();
    expect(resolveSourceKey("payment:{{payment.id}}", {})).toBeNull();
    expect(resolveSourceKey("payment:{{payment.id}}", { payment: { id: "" } })).toBeNull();
    expect(resolveSourceKey("a:{{x}}:{{y}}", { x: "1" })).toBeNull();
    expect(resolveSourceKey("x".repeat(300), {})).toHaveLength(200);
  });

  it("se guarda como source_ref", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0]).toMatchObject({ source: "flow", source_ref: "payment:pay-1" });
  });

  it("sin clave, el source_ref es el de siempre", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar" }, paymentCtx(), "s9");
    vi.useRealTimers();
    expect(db.rows("tasks")[0].source_ref).toBe("flow-1:s9:n1");
  });

  it("IDEMPOTENTE por clave: otra ejecucion con el mismo pago no crea otra tarea abierta", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, paymentCtx(), "s-1");
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, paymentCtx(), "s-2");
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
  });

  it("otro pago, otra tarea; y con la anterior completada se puede crear de nuevo", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, paymentCtx(), "s-1");
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, ctx({ variables: { payment: { id: "pay-2" } } }), "s-2");
    expect(db.rows("tasks")).toHaveLength(2);
    db.rows("tasks")[0].status = "completed";
    await run(db, { title: "Cobrar", sourceKey: "payment:{{payment.id}}" }, paymentCtx(), "s-3");
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(3);
  });

  it("una clave que no se puede resolver no se usa (no colapsa a todos los pagos en una): usa el origen de siempre", async () => {
    const db = worldCrm();
    await run(db, { title: "A", sourceKey: "payment:{{payment.id}}" }, ctx({ variables: {} }), "s-a");
    await run(db, { title: "B", sourceKey: "payment:{{payment.id}}" }, ctx({ variables: {} }), "s-b");
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(2);
    expect(db.rows("tasks").map((t) => t.source_ref)).toEqual(["flow-1:s-a:n1", "flow-1:s-b:n1"]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("vencimiento hoy + 0 dias es hoy; datos nuevos son opcionales: un nodo viejo funciona igual", async () => {
    const db = worldCrm();
    await run(db, { title: "Cobrar", dueMode: "days", dueDays: 0, priority: "high", project: "Cobranza" }, paymentCtx());
    vi.useRealTimers();
    expect(db.rows("tasks")[0]).toMatchObject({ due_date: "2026-10-13", priority: "high", project: "Cobranza", owner_id: null });
  });

  it("nunca lanza con datos nuevos y una base rota", async () => {
    const broken = { from: () => { throw new Error("la base se cayo"); } };
    await expect(createTaskNode.execute({ supabase: broken, node: { id: "n1" }, data: { title: "X", owner: "seller", sourceKey: "k:{{payment.id}}" }, context: paymentCtx(), sessionId: "s", runtime: {} } as never)).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
