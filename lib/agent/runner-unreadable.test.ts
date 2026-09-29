/**
 * EL TEST QUE PRUEBA EL ARREGLO (F10).
 *
 * Hoy un lead manda una nota de voz por Instagram o WhatsApp y el agente le
 * contesta igual, sin haberla escuchado: el mensaje entra con el texto vacio, el
 * historial lo filtra, pero el turno se agenda y responde. Esta contestando
 * cosas que no tienen nada que ver.
 *
 * Lo que este archivo fija, con el turno completo corriendo contra una base en
 * memoria y el modelo espiado:
 *
 *   DADO una conversacion con un audio sin transcribir,
 *   CUANDO corre el turno del agente,
 *   ENTONCES no se llama al modelo, no se inserta ningun mensaje saliente, y la
 *            conversacion queda needs_human = true.
 *
 * Vale para los tres modos: envio, borrador y reglas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { T0, turnWorld } from "./testing/turn-world";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

/** Una nota de voz, en el estado que se le pida. */
const voice = (over: Record<string, unknown> = {}) => ({
  text: null,
  attachments: { v: 2, items: [{ kind: "voice", status: "ready", storagePath: "ws-1/cv-1/m-0.ogg", mime: "audio/ogg" }] },
  transcript_status: "failed",
  transcript_error: "El servicio de transcripción no pudo abrir este audio.",
  ...over,
});

const conversation = (w: ReturnType<typeof turnWorld>) => w.db.rows("conversations")[0];
const outbound = (w: ReturnType<typeof turnWorld>) =>
  w.db.rows("messages").filter((m) => m.direction === "outbound");

describe("el agente NO responde a un audio que no pudo escuchar (F10)", () => {
  it("no llama al modelo, no manda nada, y la conversacion queda necesitando una persona", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    // 1. El modelo nunca se llamo.
    expect(w.modelCalls).toHaveLength(0);
    // 2. No salio ningun mensaje.
    expect(w.sent).toHaveLength(0);
    expect(outbound(w)).toHaveLength(0);
    // 3. Y la conversacion quedo marcada, con el agente apagado ahi.
    expect(conversation(w)).toMatchObject({ needs_human: true, agent_enabled: false });
    expect(conversation(w).needs_human_reason).toBe("Llegó una nota de voz que no se pudo transcribir");
    expect(conversation(w).needs_human_at).toBeTruthy();

    expect(outcome).toMatchObject({ kind: "run", status: "escalated", detail: "unreadable_media" });
  });

  it("deja el escalado en el audit_log con el agente como actor", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    const entry = w.db.rows("audit_log").find((a) => a.action === "needs_human");
    expect(entry).toMatchObject({
      entity_type: "conversation",
      entity_id: "cv-1",
      performed_by_agent_id: "agent-1",
    });
    expect((entry?.metadata as { reason?: string })?.reason).toContain("nota de voz");
  });

  it("avisa en la campana: de nada sirve marcarla si nadie mira", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.db.rows("notifications")[0]).toMatchObject({
      type: "needs_human",
      entity_type: "conversation",
      entity_id: "cv-1",
    });
  });

  it("tampoco responde en MODO BORRADOR: no deja un borrador sobre algo que no leyo", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.modelCalls).toHaveLength(0);
    expect(w.db.rows("agent_drafts")).toHaveLength(0);
    expect(conversation(w).needs_human).toBe(true);
  });

  it("un borrador que YA existia no se descarta: es trabajo hecho", async () => {
    const w = turnWorld({ draft: true });
    w.db.rows("agent_drafts").push({
      id: "d-1",
      workspace_id: "ws-1",
      conversation_id: "cv-1",
      status: "pending",
      body: "una respuesta que alguien puede aprobar",
      created_at: new Date(T0).toISOString(),
    });
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.db.rows("agent_drafts")[0]).toMatchObject({ id: "d-1", status: "pending" });
  });

  it("alcanza que UNO de la rafaga sea ilegible: responder al resto es contestar a medias", async () => {
    const w = turnWorld();
    w.addInbound("hola, buenas", 0);
    w.addInbound(null, 20, voice());
    w.clock.ms = T0 + 95_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.modelCalls).toHaveLength(0);
    expect(conversation(w).needs_human).toBe(true);
  });

  it("un video escala con su propio motivo", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, {
      attachments: { v: 2, items: [{ kind: "video", status: "ready", storagePath: "p.mp4", mime: "video/mp4" }] },
      transcript_status: "none",
    });
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(conversation(w).needs_human_reason).toContain("video");
    expect(w.modelCalls).toHaveLength(0);
  });
});

describe("el agente SI responde cuando puede entender (F9, F10)", () => {
  it("con la transcripcion lista responde normal, y la lee marcada como nota de voz", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice({ transcript: "hola, queria saber el precio", transcript_status: "ready", transcript_error: null }));
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "responded" });
    expect(w.sent).toHaveLength(1);
    expect(conversation(w).needs_human).toBe(false);

    // Y el modelo la vio, marcada: tiene que saber que es un audio transcripto.
    const prompt = JSON.stringify(w.modelCalls[0].messages);
    expect(prompt).toContain("[Nota de voz]");
    expect(prompt).toContain("hola, queria saber el precio");
  });

  it("con una imagen descripta tambien responde", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, {
      attachments: { v: 2, items: [{ kind: "image", status: "ready", storagePath: "p.jpg", mime: "image/jpeg" }] },
      media_description: "Captura del comprobante de pago por 50.000",
    });
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.sent).toHaveLength(1);
    expect(JSON.stringify(w.modelCalls[0].messages)).toContain("[Imagen]");
  });

  it("una foto CON caption responde sin esperar la descripcion: el caption alcanza", async () => {
    const w = turnWorld();
    w.addInbound("te paso el comprobante", 0, {
      attachments: { v: 2, items: [{ kind: "image", status: "ready", storagePath: "p.jpg", mime: "image/jpeg" }] },
    });
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.sent).toHaveLength(1);
  });
});

describe("mientras la transcripcion esta en camino, el turno espera (F10)", () => {
  it("un audio transcribiendose hace poco REAGENDA el turno en vez de escalar", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice({ transcript_status: "pending", transcript_error: null }));
    // 70 segundos: la ventana de silencio (60 s) ya cerro, asi que hay turno de
    // verdad, y todavia estamos dentro de los 90 s de la compuerta.
    w.clock.ms = T0 + 70_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "waiting_media" });
    expect(w.modelCalls).toHaveLength(0);
    // No se escalo: todavia hay tiempo.
    expect(conversation(w).needs_human).toBe(false);
    expect(conversation(w).agent_enabled).toBe(true);

    // Y quedo un turno agendado para volver a mirar.
    const job = w.db.rows("scheduled_jobs").find((j) => j.type === "agent_burst");
    expect(job).toBeTruthy();
    expect((job?.payload as { blocked_retry?: boolean })?.blocked_retry).toBe(true);
  });

  it("pasados los 90 segundos ya no espera: escala", async () => {
    const w = turnWorld();
    w.addInbound(null, 0, voice({ transcript_status: "pending", transcript_error: null }));
    w.clock.ms = T0 + 95_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(conversation(w).needs_human).toBe(true);
    expect(conversation(w).needs_human_reason).toContain("no terminó a tiempo");
  });
});

describe("el interruptor de la compuerta (F10)", () => {
  it("apagado, el agente vuelve a responder a ciegas (que es el problema, pero es la decision de quien lo apaga)", async () => {
    const w = turnWorld({ workspace: { agent_escalate_on_unreadable: false } });
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.modelCalls).toHaveLength(1);
    expect(conversation(w).needs_human).toBe(false);
  });

  it("ante la duda esta PRENDIDO: si no se puede leer el flag, se escala igual", async () => {
    const w = turnWorld({ workspace: { agent_escalate_on_unreadable: null } });
    w.addInbound(null, 0, voice());
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(w.modelCalls).toHaveLength(0);
    expect(conversation(w).needs_human).toBe(true);
  });
});
