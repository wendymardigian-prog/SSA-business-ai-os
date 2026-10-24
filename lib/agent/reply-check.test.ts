import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { at, T0, turnWorld } from "./testing/turn-world";
import { externalCooldownEnd } from "./reply-check";

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
    w.addInbound("quiero mas info", 0);
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

describe("externalCooldownEnd (F7, puro)", () => {
  const base = "2026-09-15T16:00:00.000Z";
  const at = (iso: string) => new Date(iso);
  it("dentro de la espera: devuelve cuando termina", () => {
    expect(
      externalCooldownEnd({ lastExternalAt: base, cooldownMinutes: 10, now: at("2026-09-15T16:03:00.000Z") }),
    ).toEqual(at("2026-09-15T16:10:00.000Z"));
  });
  it("pasada la espera: no espera, aunque el lead haya escrito dentro de ella", () => {
    // El caso real (Lautaro, 23/10/2026): ManyChat a las 16:00, el lead a las
    // 16:01, ManyChat nunca respondio. A las 16:10 el agente tiene que actuar.
    expect(
      externalCooldownEnd({ lastExternalAt: base, cooldownMinutes: 10, now: at("2026-09-15T16:10:05.000Z") }),
    ).toBeNull();
  });
  it("N=0: desactivada", () => {
    expect(externalCooldownEnd({ lastExternalAt: base, cooldownMinutes: 0, now: at("2026-09-15T16:03:00.000Z") })).toBeNull();
  });
  it("sin saliente externo: no espera", () => {
    expect(externalCooldownEnd({ lastExternalAt: null, cooldownMinutes: 10, now: at(base) })).toBeNull();
  });
});

describe("espera tras ManyChat: se reagenda en vez de rendirse (F7, 23/10/2026)", () => {
  // ManyChat manda la bienvenida 60 s antes; el lead responde a los 0 s (dentro
  // de los 10 minutos de espera) y ManyChat nunca vuelve a escribir.
  function waitingWorld() {
    const w = turnWorld({ draft: true });
    pushExternal(w, -60);
    w.addInbound("te consulto, me podrían ayudar?", 0);
    w.clock.ms = T0 + 75_000;
    return w;
  }

  it("dentro de la espera: no llama al modelo y deja el turno agendado para cuando termina", async () => {
    const w = waitingWorld();

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "skipped", detail: "external_cooldown_wait" });
    expect(w.modelCalls).toHaveLength(0);
    const job = w.db.rows("scheduled_jobs").find((j) => j.type === "agent_burst");
    expect(job).toBeDefined();
    // 10 minutos después del mensaje de ManyChat, más el margen.
    expect(new Date(job!.run_at as string).getTime()).toBe(T0 - 60_000 + 10 * 60_000 + 5_000);
    expect((job!.payload as { blocked_retry?: boolean }).blocked_retry).toBe(true);
  });

  it("al volver, si nadie respondió, el agente deja su borrador", async () => {
    const w = waitingWorld();
    await runAgentTurn(w.db.client, w.payload, w.deps);
    const job = w.db.rows("scheduled_jobs").find((j) => j.type === "agent_burst")!;

    w.clock.ms = new Date(job.run_at as string).getTime();
    const outcome = await runAgentTurn(w.db.client, job.payload, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "drafted" });
    expect(w.db.rows("agent_drafts")).toHaveLength(1);
  });

  it("al volver, si ManyChat respondió en el medio, se retira sin gastar", async () => {
    const w = waitingWorld();
    await runAgentTurn(w.db.client, w.payload, w.deps);
    const job = w.db.rows("scheduled_jobs").find((j) => j.type === "agent_burst")!;
    pushExternal(w, 120);

    w.clock.ms = new Date(job.run_at as string).getTime();
    const callsBefore = w.modelCalls.length;
    const outcome = await runAgentTurn(w.db.client, job.payload, w.deps);

    // La respuesta de ManyChat ya cerró la ráfaga: no hay nada que responder.
    expect(outcome).toMatchObject({ kind: "no_turn", reason: "nothing_to_answer" });
    expect(w.modelCalls.length).toBe(callsBefore);
    expect(w.db.rows("agent_drafts")).toHaveLength(0);
  });
});
