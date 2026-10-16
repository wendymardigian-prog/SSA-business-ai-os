import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";

/**
 * "Sugerir respuesta" (A1): una persona pide a mano que el agente redacte una
 * respuesta. Siempre deja un BORRADOR (nunca envia) y se hace aunque el mensaje
 * ya tenga respuesta o la conversacion tenga el agente apagado.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const outbound = (w: ReturnType<typeof turnWorld>, atSeconds: number, extra: Record<string, unknown> = {}) =>
  w.db.rows("messages").push({
    id: `out-${w.db.rows("messages").length + 1}`,
    conversation_id: "cv-1",
    workspace_id: "ws-1",
    direction: "outbound",
    text: "respuesta de una persona",
    created_at: at(atSeconds),
    sent_by_user_id: "u-1",
    sent_by_flow_id: null,
    sent_by_agent_id: null,
    agent_run_id: null,
    transcript: null,
    transcript_status: "none",
    media_description: null,
    attachments: null,
    interpretability: "unknown",
    ...extra,
  });

const drafts = (w: ReturnType<typeof turnWorld>) => w.db.rows("agent_drafts");

describe("el turno de Sugerir respuesta", () => {
  it("sin el flag, un mensaje que ya tiene respuesta no genera nada (control)", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    outbound(w, 30);
    w.clock.ms = T0 + 300_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ kind: "no_turn", reason: "nothing_to_answer" });
    expect(drafts(w)).toHaveLength(0);
  });

  it("con el flag, deja un borrador sobre el ultimo mensaje del contacto aunque ya se haya respondido", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("queria consultar por el curso", 0);
    outbound(w, 30);
    w.clock.ms = T0 + 300_000;

    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.sent).toHaveLength(0);
    const [draft] = drafts(w);
    expect(draft).toMatchObject({ status: "pending", burst_message_ids: ["in-1"] });
    // Queda registrado como pedido a mano.
    expect(w.db.rows("agent_runs")[0]).toMatchObject({ trigger: "manual", status: "drafted" });
  });

  it("aunque el canal este en envio directo, solo deja un borrador: nunca manda", async () => {
    const w = turnWorld({ draft: false });
    w.addInbound("hola, precio?", 0);
    w.clock.ms = T0 + 10_000;

    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);

    expect(outcome).toMatchObject({ status: "drafted" });
    expect(w.sent).toHaveLength(0);
    expect(w.db.rows("messages").filter((m) => m.direction === "outbound")).toHaveLength(0);
  });

  it("no espera la ventana de silencio", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 55);
    w.clock.ms = T0 + 56_000; // la ventana (60 s) todavia no cerro
    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);
    expect(outcome).toMatchObject({ status: "drafted" });
  });

  it("se hace aunque la conversacion tenga el agente apagado", async () => {
    const w = turnWorld({ draft: true, conversation: { agent_enabled: false } });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);
    expect(outcome).toMatchObject({ status: "drafted" });
    expect(drafts(w)).toHaveLength(1);
  });

  it("sin mensajes del contacto no hay nada que sugerir", async () => {
    const w = turnWorld({ draft: true });
    outbound(w, 0);
    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);
    expect(outcome).toMatchObject({ kind: "no_turn", reason: "nothing_to_answer" });
  });

  it("si el agente esta apagado en el canal no se sugiere (no hay agente que redacte)", async () => {
    const w = turnWorld({ draft: true, agent: { is_enabled: false } });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    const outcome = await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);
    expect(outcome).toMatchObject({ kind: "run", status: "skipped" });
    expect(drafts(w)).toHaveLength(0);
  });
});
