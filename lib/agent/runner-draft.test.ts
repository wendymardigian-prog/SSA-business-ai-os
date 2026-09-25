import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";

/**
 * El turno en modo borrador (Bloque 2c), con la base en memoria y las APIs
 * externas simuladas. Lo que se prueba: que no sale nada, que el borrador queda
 * con su rafaga, que no cierra la rafaga, que derivar y pausarse quedan como
 * sugerencia, que los guardarrailes alimentan la cola y que un envio en vuelo
 * no hace reventar el turno.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

type Exec = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const call = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as Exec).execute(input, { toolCallId: `t-${name}`, messages: [] });

const drafts = (w: ReturnType<typeof turnWorld>) => w.db.rows("agent_drafts");
const live = (w: ReturnType<typeof turnWorld>) => drafts(w).filter((d) => ["pending", "sending", "failed"].includes(d.status as string));

describe("el turno en modo borrador", () => {
  it("no envia nada: deja un borrador pendiente con la rafaga y el run queda drafted", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.addInbound("queria consultar por el curso", 20);
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.sent).toHaveLength(0);
    expect(w.db.rows("messages").filter((m) => m.direction === "outbound")).toHaveLength(0);

    const [draft] = drafts(w);
    expect(draft).toMatchObject({
      status: "pending",
      body: "Hola Ana, te cuento como funciona.",
      conversation_id: "cv-1",
      burst_message_ids: ["in-1", "in-2"],
      burst_started_at: at(0),
      burst_last_inbound_at: at(20),
    });
    // Instagram: 24 h desde el ULTIMO mensaje del lead.
    expect(draft.sendable_until).toBe(new Date(T0 + 20_000 + 24 * 3_600_000).toISOString());

    const run = w.db.rows("agent_runs")[0];
    expect(run).toMatchObject({ status: "drafted", inbound_at: at(20) });
    expect(run.responded_at ?? null).toBeNull();
    expect(draft.run_id).toBe(run.id);
  });

  it("no espera la demora deliberada: el borrador se guarda apenas esta listo", async () => {
    const w = turnWorld({ draft: true, agent: { response_delay_seconds: 60 } });
    w.addInbound("hola", 30);
    w.clock.ms = T0 + 75_000;

    await runAgentTurn(w.db.client, w.payload, w.deps);

    // Ventana cierra en 30 + 60 = 90 s. Con demora de 60 s el envio seria a los 150.
    expect(new Date(drafts(w)[0].created_at as string).getTime()).toBe(T0 + 90_000);
  });

  it("el borrador NO cierra la rafaga: el turno siguiente responde todo lo acumulado y reemplaza al anterior", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;
    await runAgentTurn(w.db.client, w.payload, w.deps);
    const first = drafts(w)[0];

    // El lead escribe antes de que nadie apruebe.
    w.addInbound("ah, y cuanto sale?", 300);
    w.clock.ms = T0 + 345_000;
    w.payload.last_message_at = at(300);
    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted" });
    expect(first.status).toBe("superseded");
    expect(live(w)).toHaveLength(1);
    expect(live(w)[0].burst_message_ids).toEqual(["in-1", "in-2"]);
    const leadTurn = JSON.stringify(w.modelCalls[1].messages);
    expect(leadTurn).toContain("hola");
    expect(leadTurn).toContain("cuanto sale");
  });

  it("un turno lento que termina despues de uno mas nuevo nace superseded y no pisa al pendiente", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;
    // Mientras este turno genera, el lead escribe y otro turno ya dejo su borrador.
    w.setModel(async () => {
      w.addInbound("sigo aca", 70);
      drafts(w).push({ id: "d-nuevo", conversation_id: "cv-1", status: "pending", burst_last_inbound_at: at(70), created_at: at(80) });
      return { text: "respuesta vieja", totalUsage: { inputTokens: 10, outputTokens: 2 } };
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted" });
    expect(outcome.kind === "run" && outcome.detail).toContain("superseded_on_create");
    expect(drafts(w).find((d) => d.id === "d-nuevo")?.status).toBe("pending");
    expect(drafts(w).find((d) => d.body === "respuesta vieja")?.status).toBe("superseded");
  });

  it("envio directo sigue igual y anota responded_at en el run", async () => {
    const w = turnWorld();
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "responded" });
    expect(drafts(w)).toHaveLength(0);
    expect(w.sent).toHaveLength(1);
    const run = w.db.rows("agent_runs")[0];
    expect(run.inbound_at).toBe(at(0));
    // El instante lo pone el envio real (reloj del sistema), no el del test.
    expect(typeof run.responded_at).toBe("string");
  });
});

describe("herramientas en modo borrador", () => {
  it("derivar y pausarse NO se ejecutan: quedan como sugerencia y el agente sigue activo", async () => {
    const w = turnWorld({ draft: true, agent: { allowed_tools: ["pausarse"] } });
    w.addInbound("no me escribas hasta el lunes porfa", 0);
    w.clock.ms = T0 + 45_000;
    w.setModel(async (input) => {
      await call(input.tools, "pausarse", { minutos: 120, motivo: "lo pidio el lead" });
      await call(input.tools, "derivar_a_humano", { motivo: "Pide una persona", resumen: "Quiere hablar con alguien" });
      return { text: "Dale, te escribe alguien del equipo.", totalUsage: { inputTokens: 100, outputTokens: 10 } };
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted" });
    const conv = w.db.rows("conversations")[0];
    expect(conv.agent_enabled).toBe(true);
    expect(conv.agent_paused_until).toBeNull();
    expect(w.db.rows("audit_log")).toHaveLength(0);
    expect(w.db.rows("notifications").some((n) => n.type === "human_takeover")).toBe(false);

    const [draft] = drafts(w);
    expect(draft.body).toBe("Dale, te escribe alguien del equipo.");
    expect(draft.suggested_actions).toEqual([
      { type: "pause", minutes: 120, reason: "lo pidio el lead", maxMinutes: 1440, autoResume: true },
      { type: "escalate", reason: "Pide una persona", summary: "Quiere hablar con alguien", reopen: true },
    ]);
  });

  it("derivar sin nada que redactar deja igual la fila en la cola, sin texto y con el motivo", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("tengo un problema raro", 0);
    w.clock.ms = T0 + 45_000;
    w.setModel(async (input) => {
      await call(input.tools, "derivar_a_humano", { motivo: "No se la respuesta", resumen: "Algo que no esta en el prompt" });
      return { text: "", totalUsage: { inputTokens: 100, outputTokens: 2 } };
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted", detail: "suggested:derivar_a_humano" });
    expect(drafts(w)[0]).toMatchObject({ status: "pending", body: null, no_reply_reason: "escalate" });
    expect(w.db.rows("conversations")[0].agent_enabled).toBe(true);
  });

  it("la descripcion de derivar cambia en modo borrador: ya no termina el turno", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;
    await runAgentTurn(w.db.client, w.payload, w.deps);
    const description = (w.modelCalls[0].tools.derivar_a_humano as { description?: string }).description ?? "";
    expect(description).toContain("Sugiere");
    expect(description).not.toContain("termina tu turno");
  });
});

describe("los guardarrailes alimentan la cola", () => {
  it("un tema vedado deja una fila sin texto con el motivo, sin llamar al modelo y sin apagar el agente", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("me hacés un descuento?", 0);
    w.clock.ms = T0 + 45_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted", detail: "guardrail:blocked_topic" });
    expect(w.modelCalls).toHaveLength(0);
    expect(drafts(w)[0]).toMatchObject({ status: "pending", body: null, no_reply_reason: "guardrail:blocked_topic" });
    expect((drafts(w)[0].suggested_actions as Array<{ type: string }>)[0].type).toBe("escalate");
    expect(w.db.rows("conversations")[0].agent_enabled).toBe(true);
  });

  it("fuera de horario no aplica: si hay una persona para aprobar, no esta fuera de horario", async () => {
    const w = turnWorld({
      draft: true,
      agent: {
        guardrails: {
          businessHours: { enabled: true, outsideMode: "notice", outsideMessage: "Estamos cerrados", slots: [{ day: 6, start: "09:00", end: "10:00" }] },
        },
      },
    });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted" });
    expect(outcome.kind === "run" && outcome.detail).toContain("outside_hours");
    expect(drafts(w)[0].body).toBe("Hola Ana, te cuento como funciona.");
  });

  it("si el modelo devuelve algo vacio, queda la fila sin texto", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;
    w.setModel(async () => ({ text: "   ", totalUsage: { inputTokens: 10, outputTokens: 1 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted", detail: "output:empty" });
    expect(drafts(w)[0]).toMatchObject({ body: null, no_reply_reason: "error:output_empty" });
  });

  it("si fallan los dos modelos, la fila es la unica senal: sin marca de error ni aviso de derivacion", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 45_000;
    w.setModel(async () => {
      throw new Error("503");
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ status: "drafted", detail: "provider_unavailable" });
    expect(drafts(w)[0]).toMatchObject({ body: null, no_reply_reason: "error:provider_unavailable" });
    expect(w.db.rows("conversations")[0].last_agent_error_at).toBeNull();
    expect(w.db.rows("notifications")).toHaveLength(0);
  });
});

describe("un envio en vuelo no hace reventar el turno", () => {
  it("con un borrador saliendo, el turno cierra skipped, se reprograma, y el reintento deja el borrador con la rafaga completa", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    // Alguien esta aprobando el borrador anterior en este instante.
    drafts(w).push({ id: "d-saliendo", conversation_id: "cv-1", status: "sending", burst_last_inbound_at: at(-600), created_at: at(-590) });
    w.clock.ms = T0 + 45_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "draft_blocked_by_send" });
    const [job] = w.db.rows("scheduled_jobs");
    expect(job).toMatchObject({ dedupe_key: "agent_burst:cv-1", status: "pending" });
    expect((job.payload as Record<string, unknown>).blocked_retry).toBe(true);
    expect(new Date(job.run_at as string).getTime()).toBe(w.clock.ms + 60_000);

    // El envio termina. El lead escribio algo mas mientras tanto.
    drafts(w)[0].status = "sent";
    w.addInbound("sigo por aca", 50);
    w.clock.ms = new Date(job.run_at as string).getTime();
    const retry = await runAgentTurn(w.db.client, { ...(job.payload as Record<string, unknown>), last_message_at: at(50) }, w.deps);

    expect(retry).toMatchObject({ status: "drafted" });
    expect(live(w)).toHaveLength(1);
    expect(live(w)[0].burst_message_ids).toEqual(["in-1", "in-2"]);
  });
});

describe("regenerar", () => {
  function withPrevious() {
    const w = turnWorld({ draft: true });
    w.addInbound("cuanto sale el curso?", 0);
    drafts(w).push({
      id: "d-prev",
      conversation_id: "cv-1",
      status: "regenerated",
      body: "Sale 500 dolares.",
      burst_message_ids: ["in-1"],
      burst_started_at: at(0),
      burst_last_inbound_at: at(0),
      applied_actions: [{ tool: "etiquetar_contacto", label: "Etiquetar al contacto", detail: null, auditLogId: "a-1" }],
      created_at: at(80),
    });
    // Horas despues: la regeneracion no espera ventana ni se descarta por vieja.
    w.clock.ms = T0 + 5 * 3_600_000;
    return w;
  }

  it("con instruccion: run manual, borrador nuevo enlazado, y el modelo ve el intento anterior y el pedido", async () => {
    const w = withPrevious();
    const outcome = await runAgentTurn(
      w.db.client,
      { ...w.payload, regenerate_of: "d-prev", regenerate_instruction: "no menciones el precio" },
      w.deps,
    );

    expect(outcome).toMatchObject({ status: "drafted" });
    expect(w.db.rows("agent_runs")[0].trigger).toBe("manual");
    const fresh = live(w)[0];
    expect(fresh).toMatchObject({ previous_draft_id: "d-prev", regenerate_instruction: "no menciones el precio", burst_message_ids: ["in-1"] });
    const sent = JSON.stringify(w.modelCalls[0].messages);
    expect(sent).toContain("Sale 500 dolares.");
    expect(sent).toContain("no menciones el precio");
    expect(sent).toContain("Etiquetar al contacto");
  });

  it("siempre deja borrador, aunque el canal haya vuelto a envio directo", async () => {
    const w = withPrevious();
    w.db.rows("agents")[0].channel_modes = {};
    await runAgentTurn(w.db.client, { ...w.payload, regenerate_of: "d-prev", regenerate_instruction: "mas corto" }, w.deps);
    expect(w.sent).toHaveLength(0);
    expect(live(w)).toHaveLength(1);
  });

  it("si el lead escribio despues, es un turno normal: la instruccion no vale pero la cadena se conserva", async () => {
    const w = withPrevious();
    w.addInbound("ah y hay cuotas?", 5 * 3600 - 70);
    const outcome = await runAgentTurn(
      w.db.client,
      { ...w.payload, last_message_at: at(5 * 3600 - 70), regenerate_of: "d-prev", regenerate_instruction: "no menciones el precio" },
      w.deps,
    );

    expect(outcome).toMatchObject({ status: "drafted" });
    const fresh = live(w)[0];
    expect(fresh.previous_draft_id).toBe("d-prev");
    expect(fresh.regenerate_instruction).toBeNull();
    expect(JSON.stringify(w.modelCalls[0].messages)).not.toContain("no menciones el precio");
    expect(fresh.burst_message_ids).toEqual(["in-1", "in-2"]);
  });
});
