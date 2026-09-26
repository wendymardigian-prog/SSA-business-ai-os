import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function pushOutbound(w: ReturnType<typeof turnWorld>, origin: string, atSeconds: number) {
  w.db.rows("messages").push({
    id: `out-${w.db.rows("messages").length + 1}`,
    conversation_id: "cv-1",
    workspace_id: "ws-1",
    direction: "outbound",
    origin,
    text: "paso del flow de ManyChat",
    status: "delivered",
    created_at: at(atSeconds),
    sent_by_agent_id: null,
    sent_by_user_id: origin === "user" ? "u-1" : null,
    sent_by_flow_id: null,
    agent_run_id: null,
  });
}

describe("espera tras respuesta externa (F7)", () => {
  it("un external hace 3 min (< 10): el turno no llama al modelo", async () => {
    const w = turnWorld();
    // ManyChat mandó su paso a los 0 s; el lead escribe a los 180 s.
    pushOutbound(w, "external", 0);
    w.addInbound("¿y cuánto sale?", 180);
    w.clock.ms = T0 + 255_000; // ventana del inbound cerrada

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "external_cooldown" });
    expect(w.modelCalls).toHaveLength(0);
  });

  it("un external hace 15 min (> 10): el turno corre normal", async () => {
    const w = turnWorld();
    pushOutbound(w, "external", 0);
    w.addInbound("¿siguen abiertos?", 15 * 60);
    w.clock.ms = T0 + (15 * 60 + 75) * 1000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "responded" });
    expect(w.modelCalls).toHaveLength(1);
  });

  it("N=0: la espera está desactivada", async () => {
    const w = turnWorld({ agent: { external_reply_cooldown_minutes: 0 } });
    pushOutbound(w, "external", 0);
    w.addInbound("hola", 60);
    w.clock.ms = T0 + 135_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "responded" });
  });

  it("un saliente 'user' reciente no activa la espera externa", async () => {
    const w = turnWorld();
    pushOutbound(w, "user", 0);
    w.addInbound("otra consulta", 120);
    w.clock.ms = T0 + 195_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    // El saliente de una persona no es 'external': no hay cooldown. (Igual el
    // turno podría cerrar por otra razón, pero nunca por external_cooldown.)
    expect(outcome).toMatchObject({ kind: "run" });
    if (outcome.kind === "run") expect(outcome.detail).not.toBe("external_cooldown");
  });
});
