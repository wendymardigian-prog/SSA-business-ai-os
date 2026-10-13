import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../testing/memory-db";
import { createTaskTool, isSimilarTitle } from "./create-task";
import { followupTool } from "./followup";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import type { AgentToolContext } from "./types";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * crear_tarea (Tareas, F23): responsable (asignado -> setter -> vendedor -> nadie), tope por conversacion, no repetir,
 * origen `agent` con el run_id, auditoria con el agente, y que NO toque `programar_seguimiento` ni `next_followup_date`.
 */

const WS = "ws-1";
const CONV = "cv-1";
const CONTACT = "c-1";
const ADMIN = "u-admin";
const OWNER = "u-owner";
const SETTER = "u-setter";
const SELLER = "u-seller";
const ASSIGNED = "u-assigned";

function fakeRun(runId: string | null = "run-1"): AiRunHandle {
  return { runId, setModel: vi.fn(), addStepUsage: vi.fn(), setFinalUsage: vi.fn(), addEmbeddingUsage: vi.fn(), addAudioUsage: vi.fn(), step: vi.fn(async () => null), setRouting: vi.fn(), setIntent: vi.fn(), close: vi.fn(async () => ({ status: "responded" }) as never) } as unknown as AiRunHandle;
}

function world(extra: Record<string, unknown[]> = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      workspace_members: [
        { workspace_id: WS, user_id: OWNER, role: "owner" },
        { workspace_id: WS, user_id: ADMIN, role: "admin" },
        { workspace_id: WS, user_id: SETTER, role: "member" },
        { workspace_id: WS, user_id: SELLER, role: "member" },
        { workspace_id: WS, user_id: ASSIGNED, role: "member" },
      ],
      contacts: [{ id: CONTACT, workspace_id: WS, setter_id: SETTER, vendedor_id: SELLER, next_followup_date: null }],
      conversations: [{ id: CONV, workspace_id: WS, contact_id: CONTACT, assigned_to: ASSIGNED }],
      tasks: [],
      notifications: [],
      audit_log: [],
      ...extra,
    },
    { unique: { tasks: (a, b) => a.workspace_id === b.workspace_id && a.source === b.source && a.source_ref === b.source_ref && a.source_ref != null && b.status !== "completed" && !b.deleted_at } },
  );
}

function ctxFor(db: ReturnType<typeof memoryDb>, over: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    supabase: db.client,
    agent: toAgentConfig(agentRow({ id: "agent-1", allowed_tools: ["crear_tarea"], tools_config: {} })),
    workspaceId: WS, conversationId: CONV, contactId: CONTACT, channelId: "ch-1", run: fakeRun(), nonce: "n", turn: { memo: new Map() }, mode: "send", ...over,
  };
}

const config = createTaskTool.configSchema.parse({});
const run = (db: ReturnType<typeof memoryDb>, input: Record<string, unknown>, ctx: Partial<AgentToolContext> = {}, cfg = config) =>
  createTaskTool.execute({ input: createTaskTool.inputSchema.parse(input), config: cfg, ctx: ctxFor(db, ctx) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
});

describe("crear_tarea (F23)", () => {
  it("crea la tarea con origen agent y el run_id, vinculada a la conversacion y al contacto", async () => {
    const db = world();
    const r = await run(db, { titulo: "Llamar al lead para cerrar", motivo: "pidio que lo llame un asesor", dias: 1 });
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(db.rows("tasks")).toHaveLength(1);
    expect(db.rows("tasks")[0]).toMatchObject({ source: "agent", source_ref: "run-1", conversation_id: CONV, contact_id: CONTACT, due_date: "2026-10-14", created_by: null });
    expect(r.forModel).toContain("No le avises al lead");
  });

  it("el responsable es la persona asignada a la conversacion; si no, el setter; si no, el vendedor", async () => {
    const a = world();
    await run(a, { titulo: "Tarea uno para revisar", motivo: "motivo valido" });
    expect(a.rows("tasks")[0].owner_id).toBe(ASSIGNED);

    const s = world({ conversations: [{ id: CONV, workspace_id: WS, contact_id: CONTACT, assigned_to: null }] });
    await run(s, { titulo: "Tarea dos para revisar", motivo: "motivo valido" });
    expect(s.rows("tasks")[0].owner_id).toBe(SETTER);

    const v = world({ conversations: [{ id: CONV, workspace_id: WS, contact_id: CONTACT, assigned_to: null }], contacts: [{ id: CONTACT, workspace_id: WS, setter_id: null, vendedor_id: SELLER }] });
    await run(v, { titulo: "Tarea tres para revisar", motivo: "motivo valido" });
    vi.useRealTimers();
    expect(v.rows("tasks")[0].owner_id).toBe(SELLER);
  });

  it("sin nadie: queda sin responsable y se avisa a CADA Owner/Admin (con recipient concreto)", async () => {
    const db = world({ conversations: [{ id: CONV, workspace_id: WS, contact_id: CONTACT, assigned_to: null }], contacts: [{ id: CONTACT, workspace_id: WS, setter_id: null, vendedor_id: null }] });
    const r = await run(db, { titulo: "Llamar al lead mañana", motivo: "pidio una llamada" });
    vi.useRealTimers();
    expect(db.rows("tasks")[0].owner_id).toBeNull();
    expect(db.rows("notifications").map((n) => n.recipient_id).sort()).toEqual([ADMIN, OWNER].sort());
    expect(db.rows("notifications").every((n) => n.recipient_id)).toBe(true);
    expect(r.forModel).toContain("sin responsable");
  });

  it("la fecha concreta manda; sin dias ni fecha usa los dias por defecto de la configuracion", async () => {
    const a = world();
    await run(a, { titulo: "Enviar la propuesta", motivo: "motivo valido", fecha: "2026-11-02" });
    expect(a.rows("tasks")[0].due_date).toBe("2026-11-02");
    const b = world();
    await run(b, { titulo: "Enviar la propuesta", motivo: "motivo valido" }, {}, createTaskTool.configSchema.parse({ defaultDueDays: 5 }));
    vi.useRealTimers();
    expect(b.rows("tasks")[0].due_date).toBe("2026-10-18");
  });

  it("tope: no mas de 3 tareas abiertas del agente por conversacion (configurable)", async () => {
    const mk = (n: number) => ({ id: `t${n}`, workspace_id: WS, conversation_id: CONV, title: `Otra cosa distinta ${n}`, source: "agent", source_ref: `r${n}`, status: "pending", deleted_at: null });
    const db = world({ tasks: [mk(1), mk(2), mk(3)] });
    const r = await run(db, { titulo: "Una tarea completamente nueva", motivo: "motivo valido" });
    expect(r.ok).toBe(false);
    expect(r.forModel).toContain("maximo es 3");
    expect(db.rows("tasks")).toHaveLength(3);
    const more = await run(db, { titulo: "Una tarea completamente nueva", motivo: "motivo valido" }, {}, createTaskTool.configSchema.parse({ maxPerConversation: 4 }));
    vi.useRealTimers();
    expect(more.ok).toBe(true);
    expect(db.rows("tasks")).toHaveLength(4);
  });

  it("las completadas no cuentan para el tope", async () => {
    const mk = (n: number) => ({ id: `t${n}`, workspace_id: WS, conversation_id: CONV, title: `Otra cosa distinta ${n}`, source: "agent", source_ref: `r${n}`, status: "completed", deleted_at: null });
    const db = world({ tasks: [mk(1), mk(2), mk(3)] });
    const r = await run(db, { titulo: "Una tarea completamente nueva", motivo: "motivo valido" });
    vi.useRealTimers();
    expect(r.ok).toBe(true);
  });

  it("no crea otra si ya hay una abierta parecida en la conversacion: dice «ya existe»", async () => {
    const db = world({ tasks: [{ id: "t1", workspace_id: WS, conversation_id: CONV, title: "Llamar al lead para cerrar la venta", source: "manual", source_ref: null, status: "pending", deleted_at: null }] });
    const r = await run(db, { titulo: "llamar al lead para cerrar", motivo: "motivo valido" });
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(r.forModel).toContain("Ya existe");
    expect(db.rows("tasks")).toHaveLength(1);
  });

  it("audita con el agente como actor y deja el motivo y el run_id", async () => {
    const db = world();
    await run(db, { titulo: "Preparar la propuesta", motivo: "el lead la pidio por chat" });
    vi.useRealTimers();
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "task", action: "task.created", performed_by_agent_id: "agent-1", actor_type: "agent" });
    expect(db.rows("audit_log")[0].metadata).toMatchObject({ origin: "tool", run_id: "run-1", reason: "el lead la pidio por chat", conversation_id: CONV });
  });

  it("dos tareas en el mismo turno (mismo run): la segunda no se crea", async () => {
    const db = world();
    await run(db, { titulo: "Primera tarea del turno", motivo: "motivo valido" });
    const second = await run(db, { titulo: "Segunda tarea muy distinta", motivo: "motivo valido" });
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
    expect(second.forModel).toContain("ya se creo una tarea");
  });

  it("sin conversacion no crea nada", async () => {
    const db = world();
    const r = await run(db, { titulo: "Una tarea cualquiera", motivo: "motivo valido" }, { conversationId: null });
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    expect(db.rows("tasks")).toHaveLength(0);
  });

  it("NO toca contacts.next_followup_date ni usa programar_seguimiento", async () => {
    const db = world();
    await run(db, { titulo: "Llamar mañana al lead", motivo: "motivo valido", dias: 1 });
    vi.useRealTimers();
    expect(db.rows("contacts")[0].next_followup_date).toBeNull();
    expect(followupTool.name).toBe("programar_seguimiento");
    expect(createTaskTool.name).not.toBe(followupTool.name);
  });

  it("el esquema pide titulo de 3 a 200, motivo, y dias O fecha (no las dos)", () => {
    const s = createTaskTool.inputSchema;
    expect(s.safeParse({ titulo: "ab", motivo: "motivo valido" }).success).toBe(false);
    expect(s.safeParse({ titulo: "x".repeat(201), motivo: "motivo valido" }).success).toBe(false);
    expect(s.safeParse({ titulo: "Titulo valido", motivo: "ab" }).success).toBe(false);
    expect(s.safeParse({ titulo: "Titulo valido", motivo: "motivo valido", dias: 1, fecha: "2026-10-20" }).success).toBe(false);
    expect(s.safeParse({ titulo: "Titulo valido", motivo: "motivo valido", fecha: "20/10" }).success).toBe(false);
    expect(s.safeParse({ titulo: "Titulo valido", motivo: "motivo valido" }).success).toBe(true);
    vi.useRealTimers();
  });

  it("la configuracion trae sus valores por defecto (3 y 2) y declara sus campos", () => {
    expect(createTaskTool.configSchema.parse({})).toEqual({ maxPerConversation: 3, defaultDueDays: 2 });
    for (const f of createTaskTool.configFields) expect(Object.keys(createTaskTool.configSchema.parse({}))).toContain(f.key);
    expect(createTaskTool.required).toBeFalsy();
    vi.useRealTimers();
  });
});

describe("isSimilarTitle", () => {
  it("igual sin acentos ni mayusculas, o uno contenido en el otro (si es largo)", () => {
    expect(isSimilarTitle("Llamar a Ana", "llamar a ana")).toBe(true);
    expect(isSimilarTitle("Enviar la propuesta comercial", "enviar la propuesta")).toBe(true);
    expect(isSimilarTitle("Llamar", "Llamar a Ana por el contrato")).toBe(false);
    expect(isSimilarTitle("Enviar propuesta", "Revisar contrato")).toBe(false);
    expect(isSimilarTitle("", "algo")).toBe(false);
  });
});
