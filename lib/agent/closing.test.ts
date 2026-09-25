import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";
import { sweepInactiveConversations } from "./closing";

/**
 * El barrido de inactividad cierra solo las conversaciones que el agente
 * atiende Y en las que ya participo. El backlog viejo queda abierto.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function conv(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: "ws-1",
    channel_id: "ch-1",
    contact_id: `c-${id}`,
    status: "open",
    deleted_at: null,
    agent_enabled: null,
    agent_paused_until: null,
    last_message_at: hoursAgo(13),
    ...over,
  };
}

function world(conversations: Record<string, unknown>[], runs: Record<string, unknown>[] = [], agent: Parameters<typeof agentRow>[0] = {}) {
  return memoryDb(
    {
      agents: [agentRow({ enabled_channel_ids: ["ch-1"], close_after_inactive_hours: 12, ...agent })],
      conversations,
      agent_runs: runs,
      scheduled_jobs: [],
    },
    { now: () => NOW },
  );
}

describe("sweepInactiveConversations", () => {
  it("cierra la conversacion inactiva donde el agente ya participo, y encola el job de cierre", async () => {
    const db = world([conv("a")], [{ id: "r-1", conversation_id: "a", source: "agent", status: "responded" }]);
    const result = await sweepInactiveConversations(db.client, NOW);

    expect(result).toEqual({ closed: 1, candidates: 1 });
    expect(db.rows("conversations")[0]).toMatchObject({ status: "closed", closed_at: NOW.toISOString() });
    expect(db.rows("scheduled_jobs")[0]).toMatchObject({ type: "conversation_close", payload: { conversationId: "a", workspaceId: "ws-1", trigger: "cron_close" } });
  });

  it("el backlog: inactiva pero SIN ningun run del agente, queda abierta (no dispara 578 resumenes el dia que se prenda el maestro)", async () => {
    const db = world([conv("vieja")]);
    const result = await sweepInactiveConversations(db.client, NOW);
    expect(result).toEqual({ closed: 0, candidates: 1 });
    expect(db.rows("conversations")[0].status).toBe("open");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("una conversacion reciente no se toca", async () => {
    const db = world([conv("reciente", { last_message_at: hoursAgo(2) })], [{ id: "r-1", conversation_id: "reciente", source: "agent" }]);
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 0 });
  });

  it("una conversacion forzada apagada (la maneja una persona) no se cierra sola aunque el agente haya participado", async () => {
    const db = world([conv("humana", { agent_enabled: false })], [{ id: "r-1", conversation_id: "humana", source: "agent" }]);
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 1 });
    expect(db.rows("conversations")[0].status).toBe("open");
  });

  it("con el agente apagado o sin canales no cierra nada", async () => {
    const db = world([conv("a")], [{ id: "r-1", conversation_id: "a", source: "agent" }], { is_enabled: false });
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 0 });
  });

  it("respeta las horas configuradas por agente", async () => {
    const db = world([conv("a", { last_message_at: hoursAgo(5) })], [{ id: "r-1", conversation_id: "a", source: "agent" }], { close_after_inactive_hours: 4 });
    expect((await sweepInactiveConversations(db.client, NOW)).closed).toBe(1);
  });
});

describe("con un borrador esperando (Bloque 2c)", () => {
  it("no cierra una conversacion con un borrador vivo: el lead espera que alguien apruebe", async () => {
    const db = world([conv("a")], [{ id: "r-1", conversation_id: "a", source: "agent", status: "drafted" }]);
    db.rows("agent_drafts").push({ id: "d-1", conversation_id: "a", status: "pending" });

    const result = await sweepInactiveConversations(db.client, NOW);

    expect(result.closed).toBe(0);
    expect(db.rows("conversations")[0].status).toBe("open");
  });

  it("un borrador ya decidido no la frena", async () => {
    const db = world([conv("a")], [{ id: "r-1", conversation_id: "a", source: "agent", status: "drafted" }]);
    db.rows("agent_drafts").push({ id: "d-1", conversation_id: "a", status: "discarded" });
    expect((await sweepInactiveConversations(db.client, NOW)).closed).toBe(1);
  });
});
