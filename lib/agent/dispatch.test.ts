import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeScheduleAgentTurn } from "./dispatch";
import { memoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";

/**
 * El despacho: el unico lugar que agenda un turno del agente. Primero las
 * automatizaciones, despues las palancas, despues agendar.
 */

const NOW = new Date("2026-09-15T16:00:00.000Z");

function world(opts: { agent?: Parameters<typeof agentRow>[0] | null; agentEnabled?: boolean; paused?: string | null } = {}) {
  return memoryDb(
    {
      agents: opts.agent === null ? [] : [agentRow({ enabled_channel_ids: ["ch-1"], ...opts.agent })],
      conversations: [
        { id: "cv-1", agent_enabled: opts.agentEnabled ?? true, agent_paused_until: opts.paused ?? null },
      ],
      agent_runs: [],
    },
    {
      now: () => NOW,
      rpc: {
        push_debounced_job: (args) => [{ job_id: "job-1", job_run_at: args.p_run_at, created: true }],
      },
    },
  );
}

const base = {
  workspaceId: "ws-1",
  channelId: "ch-1",
  contactId: "c-1",
  conversationId: "cv-1",
  now: NOW,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("la automatizacion tiene prioridad", () => {
  it.each([
    [{ claimed: true, by: "flow", flowId: "f", triggerId: "t" } as const],
    [{ claimed: true, by: "flow_session", flowId: "f" } as const],
    [{ claimed: true, by: "global_keyword" } as const],
    [{ claimed: true, by: "flow_error", flowId: "f" } as const],
  ])("si %o reclamo el mensaje, el agente NO agenda y deja un run de abstencion", async (automation) => {
    const db = world();
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation });

    expect(outcome).toMatchObject({ scheduled: false, reason: "automation_claimed" });
    expect(db.rpcCalls.filter((c) => c.name === "push_debounced_job")).toHaveLength(0);
    expect(db.rows("agent_runs")).toHaveLength(1);
    expect(db.rows("agent_runs")[0]).toMatchObject({ status: "skipped_automation", status_detail: automation.by });
  });

  it("si nadie reclamo, agenda UN turno con la ventana del agente", async () => {
    const db = world();
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } });

    expect(outcome).toMatchObject({ scheduled: true, jobId: "job-1" });
    const push = db.rpcCalls.find((c) => c.name === "push_debounced_job");
    expect(push?.args).toMatchObject({
      p_type: "agent_burst",
      p_dedupe_key: "agent_burst:cv-1",
      p_run_at: "2026-09-15T16:00:45.000Z",
      p_deadline: "2026-09-15T16:04:45.000Z",
    });
    expect(db.rows("agent_runs")).toHaveLength(0);
  });

  it("una conversacion tomada a mano (automatizaciones pausadas) no silencia al agente: lo decide su toggle", async () => {
    const db = world();
    const outcome = await maybeScheduleAgentTurn(db.client, {
      ...base,
      automation: { claimed: false, reason: "automation_paused" },
    });
    expect(outcome).toMatchObject({ scheduled: true });
  });
});

describe("las palancas", () => {
  it("con el maestro del canal apagado, no agenda y deja el rastro", async () => {
    const db = world({ agent: { enabled_channel_ids: ["otro-canal"] } });
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } });

    expect(outcome).toMatchObject({ scheduled: false, reason: "channel_off" });
    expect(db.rows("agent_runs")[0]).toMatchObject({ status: "skipped", status_detail: "channel_off" });
  });

  it("pausado por un flow: no agenda y deja el rastro", async () => {
    const db = world({ paused: "infinity" });
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } });
    expect(outcome).toMatchObject({ scheduled: false, reason: "paused" });
    expect(db.rows("agent_runs")[0]).toMatchObject({ status: "skipped", status_detail: "paused" });
  });

  it("si la conversacion nunca tuvo el agente encendido, no agenda y NO llena la tabla de runs", async () => {
    const db = world({ agentEnabled: false });
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } });
    expect(outcome).toMatchObject({ scheduled: false, reason: "not_enabled_here" });
    expect(db.rows("agent_runs")).toHaveLength(0);
  });

  it("sin agentes en el workspace no hace nada", async () => {
    const db = world({ agent: null });
    const outcome = await maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } });
    expect(outcome).toMatchObject({ scheduled: false, reason: "no_agent" });
    expect(db.rows("agent_runs")).toHaveLength(0);
  });

  it("nunca lanza: si agendar falla, devuelve error y la recepcion del mensaje sigue", async () => {
    const db = memoryDb({ agents: [agentRow()], conversations: [{ id: "cv-1", agent_enabled: true, agent_paused_until: null }] });
    await expect(
      maybeScheduleAgentTurn(db.client, { ...base, automation: { claimed: false, reason: "no_trigger" } }),
    ).resolves.toMatchObject({ scheduled: false, reason: "error" });
  });
});
