/**
 * «Crear una tarea cuando derive a una persona» (Tareas, F24). El comportamiento de escalar con la opcion APAGADA lo fija
 * `escalate-characterization.test.ts`; aca, lo que suma la opcion PRENDIDA y que nunca rompe el escalamiento.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: mocks.notify }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: mocks.audit, auditAsSystem: mocks.audit }));

import { escalateToHuman, type EscalateArgs } from "./escalate";

const WS = "ws-1";
const CONV = "conv-1";
const CONTACT = "contact-1";
const AGENT = "agent-1";

const args = (over: Partial<EscalateArgs> = {}): EscalateArgs => ({
  workspaceId: WS, conversationId: CONV, contactId: CONTACT, channelId: "ch-1", agentId: AGENT, runId: "run-1",
  reason: "El lead pidio hablar con una persona", summary: "Quiere precio y fechas", origin: "tool", ...over,
});

function world(opts: { flag?: boolean; assigned?: string | null; setter?: string | null } = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      workspace_members: [
        { workspace_id: WS, user_id: "u-owner", role: "owner" },
        { workspace_id: WS, user_id: "u-setter", role: "member" },
        { workspace_id: WS, user_id: "u-assigned", role: "member" },
      ],
      conversations: [{ id: CONV, workspace_id: WS, agent_enabled: true, is_automation_paused: false, status: "open", assigned_to: opts.assigned === undefined ? "u-assigned" : opts.assigned, contact_id: CONTACT }],
      contacts: [{ id: CONTACT, workspace_id: WS, display_name: "Ana Pérez", instagram_username: null, setter_id: opts.setter === undefined ? "u-setter" : opts.setter, vendedor_id: null }],
      agents: [{ id: AGENT, workspace_id: WS, guardrails: { escalation: { createTaskOnEscalate: opts.flag ?? true } } }],
      tasks: [],
    },
    { unique: { tasks: (a, b) => a.workspace_id === b.workspace_id && a.source === b.source && a.source_ref === b.source_ref && a.source_ref != null && b.status !== "completed" && !b.deleted_at } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
});

describe("crear una tarea al derivar (F24)", () => {
  it("con la opcion prendida deja una tarea del agente, vinculada a la conversacion, a cargo de la persona asignada", async () => {
    const db = world();
    await escalateToHuman(db.client, args());
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
    expect(db.rows("tasks")[0]).toMatchObject({ source: "agent", conversation_id: CONV, contact_id: CONTACT, owner_id: "u-assigned", priority: "high", due_date: "2026-10-13" });
    expect(db.rows("tasks")[0].description).toContain("Quiere precio y fechas");
  });

  it("el responsable sigue el mismo orden: asignada, setter, vendedor, nadie (y avisa a Owner/Admin)", async () => {
    const s = world({ assigned: null });
    await escalateToHuman(s.client, args());
    expect(s.rows("tasks")[0].owner_id).toBe("u-setter");
    const n = world({ assigned: null, setter: null });
    await escalateToHuman(n.client, args());
    vi.useRealTimers();
    expect(n.rows("tasks")[0].owner_id).toBeNull();
    expect(mocks.notify.mock.calls.filter(([a]) => a.type === "task_assigned" && a.recipientId === "u-owner")).toHaveLength(1);
  });

  it("el escalamiento y sus avisos NO cambian: la misma llamada de siempre al aviso `human_takeover`", async () => {
    const withTask = world();
    await escalateToHuman(withTask.client, args());
    const without = world({ flag: false });
    await escalateToHuman(without.client, args());
    vi.useRealTimers();
    const takeover = (calls: unknown[][]) => calls.map(([a]) => a as { type: string }).filter((a) => a.type === "human_takeover");
    expect(takeover(mocks.notify.mock.calls)).toHaveLength(2);
    expect(withTask.rows("conversations")[0]).toMatchObject({ agent_enabled: false, is_automation_paused: true });
    expect(without.rows("conversations")[0]).toMatchObject({ agent_enabled: false, is_automation_paused: true });
  });

  it("con la opcion apagada no crea nada", async () => {
    const db = world({ flag: false });
    await escalateToHuman(db.client, args());
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(0);
  });

  it("derivar dos veces en el mismo turno deja una sola tarea abierta", async () => {
    const db = world();
    await escalateToHuman(db.client, args());
    await escalateToHuman(db.client, args());
    vi.useRealTimers();
    expect(db.rows("tasks")).toHaveLength(1);
  });

  it("si crear la tarea falla, el escalamiento sigue y no lanza", async () => {
    const db = world();
    const original = db.client.from.bind(db.client);
    const failing = { ...db.client, from: (t: string) => (t === "tasks" ? (() => { throw new Error("caida de tareas"); })() : original(t as never)) } as never;
    await expect(escalateToHuman(failing, args())).resolves.toBeDefined();
    vi.useRealTimers();
    expect(db.rows("conversations")[0]).toMatchObject({ agent_enabled: false, is_automation_paused: true });
    expect(mocks.notify.mock.calls.some(([a]) => a.type === "human_takeover")).toBe(true);
  });
});
