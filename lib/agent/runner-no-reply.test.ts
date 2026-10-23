import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";

/**
 * "No hace falta responder" (00259): el agente decide que el ultimo mensaje
 * solo cierra la charla. El turno termina sin enviar ni dejar borrador, y la
 * conversacion queda marcada; la compuerta del runner frena los casos en que
 * equivocarse dejaria a un lead sin respuesta.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

type Tool = { execute: (i: unknown, o: unknown) => Promise<unknown> };

function useNoReply(w: ReturnType<typeof turnWorld>, text = "") {
  w.setModel(async (input) => {
    await (input.tools.no_hace_falta_responder as Tool).execute({ motivo: "el lead solo agradecio" }, { toolCallId: "t1", messages: [] });
    return { text, totalUsage: { inputTokens: 100, outputTokens: 5 } };
  });
}

const marks = (w: ReturnType<typeof turnWorld>) => w.db.rpcCalls.filter((c) => c.name === "set_conversation_no_reply");

describe("no hace falta responder", () => {
  it("un gracias en envio directo: no sale nada, el run lo dice y la conversacion queda marcada", async () => {
    const w = turnWorld();
    w.addInbound("gracias!!", 0);
    w.clock.ms = T0 + 45_000;
    useNoReply(w);

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "no_reply_needed" });
    expect(w.sent).toHaveLength(0);
    expect(marks(w)).toHaveLength(1);
    expect(marks(w)[0].args).toMatchObject({
      p_conversation_id: "cv-1",
      p_needed: false,
      p_reason: "agent",
      p_expected_last_inbound_at: at(0),
    });
  });

  it("en modo borrador no deja ningun borrador para aprobar", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("genial, gracias", 0);
    w.clock.ms = T0 + 45_000;
    useNoReply(w);

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "skipped", detail: "no_reply_needed" });
    expect(w.db.rows("agent_drafts")).toHaveLength(0);
  });

  it("con una pregunta en la tanda la compuerta la rechaza: no se marca y el turno sigue", async () => {
    const w = turnWorld();
    w.addInbound("gracias", 0);
    w.addInbound("y cuanto sale?", 10);
    w.clock.ms = T0 + 60_000;
    useNoReply(w, "Sale 100 dolares.");

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(marks(w)).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "responded" });
    expect(w.db.rows("agent_run_steps").some((s) => s.name === "no_reply_rejected")).toBe(true);
  });

  it("despues de una promesa nuestra ('dame un momento') la compuerta tampoco deja marcar", async () => {
    const w = turnWorld();
    w.db.rows("messages").push({
      id: "out-promesa",
      conversation_id: "cv-1",
      workspace_id: "ws-1",
      direction: "outbound",
      text: "Voy a buscar el link para pasartela, dame un momento",
      created_at: at(-60),
      sent_by_user_id: null,
      sent_by_flow_id: null,
      sent_by_agent_id: null,
      agent_run_id: null,
      transcript: null,
      transcript_status: "none",
      media_description: null,
      attachments: null,
      interpretability: "unknown",
    });
    w.addInbound("Gracias", 0);
    w.clock.ms = T0 + 45_000;
    useNoReply(w, "Acá tenés el link.");

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(marks(w)).toHaveLength(0);
    expect(w.db.rows("agent_run_steps").some((s) => s.name === "no_reply_rejected")).toBe(true);
  });

  it("cuando una persona pide la sugerencia, la herramienta no se ofrece", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("gracias", 0);
    w.clock.ms = T0 + 45_000;

    await runAgentTurn(w.db.client, { ...w.payload, suggest: true }, w.deps);

    expect(Object.keys(w.modelCalls[0].tools)).not.toContain("no_hace_falta_responder");
    expect(Object.keys(w.modelCalls[0].tools)).toContain("derivar_a_humano");
  });
});
