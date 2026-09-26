import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { T0, turnWorld } from "./testing/turn-world";
import type { Rule } from "./rules/evaluate";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Mundo con el canal ch-1 en modo reglas y las reglas dadas. */
function rulesWorld(rules: Rule[], defaultAction: "send" | "draft" | "skip" = "draft") {
  return turnWorld({
    agent: {
      channel_modes: { "ch-1": "rules" } as never,
      response_rules: rules as never,
      response_rules_default: defaultAction,
    },
  });
}

const R = {
  buttonSkip: { id: "r1", enabled: true, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] } as Rule,
  priceDraft: { id: "r3", enabled: true, action: "draft", conditions: [{ field: "response.text", op: "contains_any", value: ["precio"] }] } as Rule,
  shortSend: { id: "r9", enabled: true, action: "send", conditions: [{ field: "inbound.length", op: "lt", value: 25 }, { field: "response.has_link", op: "is", value: false }] } as Rule,
};

describe("integración de reglas en el turno (F9)", () => {
  it("no responder antes de generar: 0 llamadas al modelo", async () => {
    const w = rulesWorld([R.buttonSkip]);
    w.addInbound("si enviamelo", 0);
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "rule:r1" });
    expect(w.modelCalls).toHaveLength(0);
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { rule_id?: string }).rule_id).toBe("r1");
  });

  it("enviar directo con ventana abierta: envía", async () => {
    const w = rulesWorld([R.shortSend]);
    w.addInbound("ok gracias", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "De nada!", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "responded" });
    expect(w.sent).toHaveLength(1);
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { action?: string }).action).toBe("send");
  });

  it("dejar borrador: guarda el borrador y no envía", async () => {
    const w = rulesWorld([R.priceDraft]);
    w.addInbound("cuanto sale?", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "El precio es 500 USD", totalUsage: { inputTokens: 10, outputTokens: 5 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.sent).toHaveLength(0);
    expect(w.db.rows("agent_drafts")).toHaveLength(1);
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { rule_id?: string }).rule_id).toBe("r3");
  });

  it("ninguna regla coincide: cae en la acción por defecto (draft)", async () => {
    const w = rulesWorld([R.priceDraft], "draft");
    w.addInbound("una pregunta larga sobre el temario y las fechas de cursada", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "Te cuento sobre el temario", totalUsage: { inputTokens: 10, outputTokens: 5 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { action?: string }).action).toBe("draft");
  });

  it("un guardarraíl gana sobre 'enviar directo'", async () => {
    // Tema vedado: el guardarrail frena antes de las reglas.
    const w = rulesWorld([R.shortSend]);
    w.deps = { ...w.deps };
    // Forzamos un guardarrail: mensaje con enojo fuerte activa escalation.
    const world = turnWorld({
      agent: {
        channel_modes: { "ch-1": "rules" } as never,
        response_rules: [R.shortSend] as never,
        response_rules_default: "send",
        guardrails: { escalation: { frustration: true, urgency: false, maxUnresolvedTurns: 6, exchangeGapMinutes: 30 } } as never,
      },
    });
    world.addInbound("esto es una ESTAFA horrible los odio", 0);
    world.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(world.db.client, world.payload, world.deps);
    // En modo reglas un guardarrail deja una fila en la cola (no envía).
    expect(outcome.kind).toBe("run");
    expect(world.sent).toHaveLength(0);
  });
});
