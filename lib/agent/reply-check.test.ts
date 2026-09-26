import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";
import { withinExternalCooldown } from "./reply-check";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Empuja un saliente external a la base (lo que haría el refresco al traerlo de Zernio). */
function pushExternal(w: ReturnType<typeof turnWorld>, atSeconds: number) {
  w.db.rows("messages").push({
    id: `ext-${w.db.rows("messages").length + 1}`,
    conversation_id: "cv-1",
    workspace_id: "ws-1",
    direction: "outbound",
    origin: "external",
    text: "respuesta de ManyChat",
    status: "delivered",
    created_at: at(atSeconds),
    sent_by_agent_id: null,
    sent_by_user_id: null,
    sent_by_flow_id: null,
    agent_run_id: null,
  });
}

describe("verificación antes de responder (F5)", () => {
  it("1. sin saliente previo: el turno responde normal", async () => {
    const w = turnWorld();
    w.addInbound("hola, cuánto sale?", 0);
    w.clock.ms = T0 + 75_000;

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "responded" });
    expect(w.modelCalls).toHaveLength(1);
  });

  it("2. una respuesta de ManyChat que sólo aparece al refrescar: abstiene sin tokens", async () => {
    const w = turnWorld();
    w.addInbound("si enviamelo", 0);
    w.clock.ms = T0 + 75_000;
    // El refresco del momento 1 trae el saliente de ManyChat (a los 3 s).
    w.deps.refresh = async () => {
      pushExternal(w, 3);
      return { ok: true, inserted: 1, error: null };
    };

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "already_answered", detail: "moment_1" });
    expect(w.modelCalls).toHaveLength(0); // cero llamadas al modelo
    expect(w.sent).toHaveLength(0);
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { moment?: number }).moment).toBe(1);
  });

  it("3. alguien responde durante la generación: el momento 2 descarta", async () => {
    const w = turnWorld();
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    // El momento 1 no ve nada; mientras el modelo genera, entra un saliente.
    w.setModel(async () => {
      pushExternal(w, 76);
      return { text: "Hola, te cuento", totalUsage: { inputTokens: 10, outputTokens: 5 } };
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "already_answered", detail: "after_generation" });
    expect(w.modelCalls).toHaveLength(1); // generó, pero no envió
    expect(w.sent).toHaveLength(0);
  });

  it("5. refresco fallido en modo directo: se degrada a borrador", async () => {
    const w = turnWorld();
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    let call = 0;
    w.deps.refresh = async () => {
      call++;
      // momento 1 ok (sin novedades); momento 2 falla.
      return call === 1 ? { ok: true, inserted: 0, error: null } : { ok: false, inserted: 0, error: "timeout" };
    };

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.sent).toHaveLength(0);
    expect(w.db.rows("agent_drafts")).toHaveLength(1);
    const run = w.db.rows("agent_runs")[0];
    expect((run.routing as { refresh?: string }).refresh).toBe("failed");
  });

  it("6. refresco fallido en modo borrador: borrador normal igual", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    w.deps.refresh = async () => ({ ok: false, inserted: 0, error: "timeout" });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.db.rows("agent_drafts")).toHaveLength(1);
  });
});

describe("withinExternalCooldown (F7, puro)", () => {
  const base = "2026-09-15T16:00:00.000Z";
  it("dentro de la ventana: espera", () => {
    expect(
      withinExternalCooldown({
        lastInboundAt: "2026-09-15T16:03:00.000Z",
        lastExternalAt: base,
        cooldownMinutes: 10,
      }),
    ).toBe(true);
  });
  it("fuera de la ventana: no espera", () => {
    expect(
      withinExternalCooldown({
        lastInboundAt: "2026-09-15T16:11:00.000Z",
        lastExternalAt: base,
        cooldownMinutes: 10,
      }),
    ).toBe(false);
  });
  it("N=0: desactivada", () => {
    expect(
      withinExternalCooldown({ lastInboundAt: "2026-09-15T16:03:00.000Z", lastExternalAt: base, cooldownMinutes: 0 }),
    ).toBe(false);
  });
  it("sin saliente externo: no espera", () => {
    expect(
      withinExternalCooldown({ lastInboundAt: base, lastExternalAt: null, cooldownMinutes: 10 }),
    ).toBe(false);
  });
});
