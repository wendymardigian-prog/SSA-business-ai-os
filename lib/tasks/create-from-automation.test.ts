import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { createTaskFromAutomation, firstMember, resolveConversationResponsible, type AutomationTaskInput } from "./create-from-automation";

const WS = "ws-1";
const OWNER = "u-owner";
const ADMIN = "u-admin";
const MEMBER = "u-member";
const OUTSIDER = "u-outsider";

const world = (extra: Record<string, unknown[]> = {}) =>
  memoryDb(
    {
      workspace_members: [
        { workspace_id: WS, user_id: OWNER, role: "owner" },
        { workspace_id: WS, user_id: ADMIN, role: "admin" },
        { workspace_id: WS, user_id: MEMBER, role: "member" },
      ],
      contacts: [{ id: "c1", workspace_id: WS, setter_id: "u-member", vendedor_id: null }],
      conversations: [{ id: "cv1", workspace_id: WS, assigned_to: null, contact_id: "c1" }],
      tasks: [],
      notifications: [],
      audit_log: [],
      ...extra,
    },
    { unique: { tasks: (a, b) => a.workspace_id === b.workspace_id && a.source === b.source && a.source_ref === b.source_ref && a.source_ref != null && b.status !== "completed" && !b.deleted_at } },
  );

const input = (over: Partial<AutomationTaskInput> = {}): AutomationTaskInput => ({
  workspaceId: WS, title: "Llamar a Ana", source: "flow", sourceRef: "f1:s1:n1",
  actor: { kind: "flow", label: "Automatización", flowId: "f1", runId: "s1", nodeId: "n1" }, notifyIfUnassigned: false, ...over,
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("createTaskFromAutomation (F22, F23, F26)", () => {
  it("crea la tarea con origen flow y su referencia, vinculada al contacto y la conversacion", async () => {
    const db = world();
    const r = await createTaskFromAutomation(db.client, input({ ownerId: MEMBER, contactId: "c1", conversationId: "cv1", dueDate: "2026-10-20", priority: "high", project: "  Lanzamiento  Q4 " }));
    expect(r.ok && !r.duplicate).toBe(true);
    expect(db.rows("tasks")[0]).toMatchObject({ title: "Llamar a Ana", source: "flow", source_ref: "f1:s1:n1", owner_id: MEMBER, contact_id: "c1", conversation_id: "cv1", due_date: "2026-10-20", priority: "high", project: "Lanzamiento Q4", project_key: "lanzamiento q4", created_by: null });
  });

  it("sin titulo no crea nada (no es un error)", async () => {
    const db = world();
    const r = await createTaskFromAutomation(db.client, input({ title: "   " }));
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(db.rows("tasks")).toHaveLength(0);
  });

  it("IDEMPOTENTE: el mismo (origen, referencia) no crea dos tareas abiertas", async () => {
    const db = world();
    const first = await createTaskFromAutomation(db.client, input());
    const second = await createTaskFromAutomation(db.client, input());
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(db.rows("tasks")).toHaveLength(1);
    expect(db.rows("audit_log")).toHaveLength(1);
  });

  it("otro nodo del mismo flujo crea la suya (otra referencia)", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ sourceRef: "f1:s1:n1" }));
    await createTaskFromAutomation(db.client, input({ sourceRef: "f1:s1:n2" }));
    expect(db.rows("tasks")).toHaveLength(2);
  });

  it("un responsable que no es del equipo: la tarea queda sin responsable y se avisa A CADA Owner/Admin", async () => {
    const db = world();
    const r = await createTaskFromAutomation(db.client, input({ ownerId: OUTSIDER, notifyIfUnassigned: true }));
    expect(r.ok && !r.duplicate && r.ownerDropped).toBe(true);
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    expect(db.rows("notifications").map((n) => n.recipient_id).sort()).toEqual([ADMIN, OWNER].sort());
    expect(db.rows("notifications").every((n) => n.type === "task_assigned" && n.entity_type === "task" && n.recipient_id)).toBe(true);
  });

  it("elegir «nadie» a proposito no avisa a nadie", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ ownerId: null, notifyIfUnassigned: false }));
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("el agente sin nadie a quien asignarle avisa a Owner/Admin", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ source: "agent", sourceRef: "run-1", ownerId: null, notifyIfUnassigned: true, actor: { kind: "agent", label: "Agente de IA", agentId: "a1", runId: "run-1", origin: "tool" } }));
    expect(db.rows("notifications").map((n) => n.recipient_id).sort()).toEqual([ADMIN, OWNER].sort());
  });

  it("con responsable, le avisa a el (y no a Owner/Admin)", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ ownerId: MEMBER, followerIds: [ADMIN, OUTSIDER] }));
    const to = db.rows("notifications").map((n) => `${n.type}:${n.recipient_id}`).sort();
    expect(to).toEqual([`task_assigned:${MEMBER}`, `task_follow_added:${ADMIN}`].sort());
    expect(db.rows("tasks")[0].follower_ids).toEqual([ADMIN]);
  });

  it("audita como el sistema (flujo) con su etiqueta, o como el agente con su id", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ ownerId: MEMBER }));
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "task", action: "task.created", actor_type: "system", actor_label: "Automatización", performed_by: null });
    const db2 = world();
    await createTaskFromAutomation(db2.client, input({ source: "agent", sourceRef: "run-9", ownerId: MEMBER, reason: "el lead pidio una llamada", actor: { kind: "agent", label: "Agente de IA", agentId: "a1", runId: "run-9", origin: "tool" } }));
    expect(db2.rows("audit_log")[0]).toMatchObject({ entity_type: "task", action: "task.created", actor_type: "agent", performed_by_agent_id: "a1" });
    expect((db2.rows("audit_log")[0].metadata as Record<string, unknown>)).toMatchObject({ origin: "tool", run_id: "run-9", reason: "el lead pidio una llamada" });
  });

  it("recorta los textos largos y descarta una fecha o un contacto que no valen", async () => {
    const db = world();
    await createTaskFromAutomation(db.client, input({ title: "x".repeat(500), description: "y".repeat(9000), dueDate: "mañana", contactId: "no-existe", priority: "maxima" }));
    const t = db.rows("tasks")[0];
    expect((t.title as string).length).toBe(200);
    expect((t.description as string).length).toBe(5000);
    expect(t).toMatchObject({ due_date: null, contact_id: null, priority: "normal" });
  });

  it("NUNCA lanza: un fallo de la base se registra con [tareas] y devuelve ok:false", async () => {
    const broken = { from: () => { throw new Error("caida de la base"); } } as never;
    const r = await createTaskFromAutomation(broken, input());
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[tareas]"), expect.anything());
  });
});

describe("a quien le toca (F23)", () => {
  it("firstMember: el primero del equipo, en orden", () => {
    const members = new Set(["a", "b"]);
    expect(firstMember(["x", "b", "a"], members)).toBe("b");
    expect(firstMember([null, undefined, "z"], members)).toBeNull();
  });

  it("persona asignada -> setter -> vendedor -> nadie", async () => {
    const base = { workspaceId: WS, conversationId: "cv1", contactId: null };
    // Asignada a la conversacion (y es del equipo): gana.
    const a = world({ conversations: [{ id: "cv1", workspace_id: WS, assigned_to: ADMIN, contact_id: "c1" }] });
    expect(await resolveConversationResponsible(a.client, base)).toBe(ADMIN);
    // Sin asignada: el setter del contacto.
    expect(await resolveConversationResponsible(world().client, base)).toBe(MEMBER);
    // Sin setter: el vendedor.
    const v = world({ contacts: [{ id: "c1", workspace_id: WS, setter_id: null, vendedor_id: OWNER }] });
    expect(await resolveConversationResponsible(v.client, base)).toBe(OWNER);
    // Nadie.
    const n = world({ contacts: [{ id: "c1", workspace_id: WS, setter_id: null, vendedor_id: null }] });
    expect(await resolveConversationResponsible(n.client, base)).toBeNull();
  });

  it("una persona asignada que ya no es del equipo se salta", async () => {
    const db = world({ conversations: [{ id: "cv1", workspace_id: WS, assigned_to: OUTSIDER, contact_id: "c1" }] });
    expect(await resolveConversationResponsible(db.client, { workspaceId: WS, conversationId: "cv1", contactId: null })).toBe(MEMBER);
  });

  it("nunca lanza", async () => {
    const broken = { from: () => { throw new Error("x"); } } as never;
    expect(await resolveConversationResponsible(broken, { workspaceId: WS, conversationId: "cv1", contactId: null })).toBeNull();
  });
});
