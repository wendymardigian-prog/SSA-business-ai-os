import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";
import { sweepInactiveConversations, SWEEP_MAX_AGE_DAYS } from "./closing";

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

/**
 * La consulta de la migracion 00306 (`closable_inactive_conversations`), condicion
 * por condicion, sobre las tablas en memoria. Si se cambia el SQL, se cambia aca.
 */
function closableRpc(args: Record<string, unknown>, db: MemoryDb) {
  const inactiveBefore = String(args.p_inactive_before);
  const activeSince = String(args.p_active_since);
  const nowIso = String(args.p_now);
  const channels = args.p_channel_ids as string[];
  const rows = db
    .rows("conversations")
    .filter(
      (c) =>
        c.workspace_id === args.p_workspace_id &&
        c.status === "open" &&
        c.deleted_at === null &&
        channels.includes(c.channel_id as string) &&
        String(c.last_message_at) < inactiveBefore &&
        String(c.last_message_at) >= activeSince &&
        c.agent_enabled !== false &&
        (c.agent_paused_until === null || String(c.agent_paused_until) <= nowIso) &&
        db.rows("agent_runs").some((r) => r.conversation_id === c.id && r.source === "agent") &&
        !db.rows("agent_drafts").some((d) => d.conversation_id === c.id && ["pending", "sending", "failed"].includes(d.status as string)),
    )
    .sort((a, b) => String(a.last_message_at).localeCompare(String(b.last_message_at)))
    .slice(0, Number(args.p_limit));
  return rows.map((c) => ({
    id: c.id,
    channel_id: c.channel_id,
    agent_enabled: c.agent_enabled,
    agent_paused_until: c.agent_paused_until,
    last_message_at: c.last_message_at,
  }));
}

function world(conversations: Record<string, unknown>[], runs: Record<string, unknown>[] = [], agent: Parameters<typeof agentRow>[0] = {}) {
  return memoryDb(
    {
      agents: [agentRow({ enabled_channel_ids: ["ch-1"], close_after_inactive_hours: 12, ...agent })],
      conversations,
      agent_runs: runs,
      scheduled_jobs: [],
    },
    { now: () => NOW, rpc: { closable_inactive_conversations: (args, db) => closableRpc(args, db) } },
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
    expect(result).toEqual({ closed: 0, candidates: 0 });
    expect(db.rows("conversations")[0].status).toBe("open");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("una conversacion reciente no se toca", async () => {
    const db = world([conv("reciente", { last_message_at: hoursAgo(2) })], [{ id: "r-1", conversation_id: "reciente", source: "agent" }]);
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 0 });
  });

  it("una conversacion forzada apagada (la maneja una persona) no se cierra sola aunque el agente haya participado", async () => {
    const db = world([conv("humana", { agent_enabled: false })], [{ id: "r-1", conversation_id: "humana", source: "agent" }]);
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 0 });
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

describe("el barrido no se traba y no repasa lo mismo (00306)", () => {
  const run = (id: string) => ({ id: `r-${id}`, conversation_id: id, source: "agent", status: "responded" });

  it("las viejas sin participacion del agente no tapan a las que si se pueden cerrar", async () => {
    // Antes: las 50 mas viejas (siempre las mismas, sin runs) ocupaban todo el lote.
    const sinRuns = Array.from({ length: 60 }, (_, i) => conv(`vieja-${i}`, { last_message_at: hoursAgo(100 + i) }));
    const db = world([...sinRuns, conv("buena", { last_message_at: hoursAgo(13) })], [run("buena")]);

    const result = await sweepInactiveConversations(db.client, NOW);

    expect(result.closed).toBe(1);
    expect(db.rows("conversations").find((c) => c.id === "buena")?.status).toBe("closed");
  });

  it("es UN pedido a la base por agente, no uno por conversacion", async () => {
    const convs = Array.from({ length: 40 }, (_, i) => conv(`c-${i}`));
    const db = world(convs, convs.map((c) => run(c.id as string)));

    await sweepInactiveConversations(db.client, NOW);

    // Antes eran dos consultas por conversacion (agent_runs y agent_drafts).
    expect(db.rpcCalls.filter((c) => c.name === "closable_inactive_conversations")).toHaveLength(1);
    expect(db.rows("conversations").filter((c) => c.status === "closed")).toHaveLength(40);
  });

  it("el piso de fecha: lo que lleva mas de SWEEP_MAX_AGE_DAYS inactivo es backlog y no se cierra solo", async () => {
    const viejo = conv("viejo", { last_message_at: hoursAgo(24 * (SWEEP_MAX_AGE_DAYS + 1)) });
    const dentro = conv("dentro", { last_message_at: hoursAgo(24 * (SWEEP_MAX_AGE_DAYS - 1)) });
    const db = world([viejo, dentro], [run("viejo"), run("dentro")]);

    const result = await sweepInactiveConversations(db.client, NOW);

    expect(result.closed).toBe(1);
    expect(db.rows("conversations").find((c) => c.id === "viejo")?.status).toBe("open");
    expect(db.rows("conversations").find((c) => c.id === "dentro")?.status).toBe("closed");
  });

  it("una conversacion con el agente pausado no se cierra (y no tapa a las demas)", async () => {
    const pausada = conv("pausada", { last_message_at: hoursAgo(100), agent_paused_until: new Date(NOW.getTime() + 3_600_000).toISOString() });
    const db = world([pausada, conv("normal")], [run("pausada"), run("normal")]);

    const result = await sweepInactiveConversations(db.client, NOW);

    expect(result.closed).toBe(1);
    expect(db.rows("conversations").find((c) => c.id === "pausada")?.status).toBe("open");
  });

  it("si la base no contesta, no lanza ni cierra nada", async () => {
    const db = memoryDb(
      {
        agents: [agentRow({ enabled_channel_ids: ["ch-1"], close_after_inactive_hours: 12 })],
        conversations: [conv("a")],
        agent_runs: [run("a")],
        scheduled_jobs: [],
      },
      { now: () => NOW, rpc: { closable_inactive_conversations: () => { throw new Error("sin conexion"); } } },
    );
    await expect(sweepInactiveConversations(db.client, NOW)).resolves.toEqual({ closed: 0, candidates: 0 });
    expect(db.rows("conversations")[0].status).toBe("open");
  });

  it("la red de seguridad: si la base devolviera una conversacion que resolveAgentState no da por activa, no se cierra", async () => {
    const db = memoryDb(
      {
        agents: [agentRow({ enabled_channel_ids: ["ch-1"], close_after_inactive_hours: 12 })],
        conversations: [conv("a", { agent_enabled: false })],
        agent_runs: [run("a")],
        scheduled_jobs: [],
      },
      { now: () => NOW, rpc: { closable_inactive_conversations: (_args, d) => d.rows("conversations").map((c) => ({ ...c })) } },
    );
    expect(await sweepInactiveConversations(db.client, NOW)).toEqual({ closed: 0, candidates: 1 });
    expect(db.rows("conversations")[0].status).toBe("open");
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
