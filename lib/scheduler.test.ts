import { describe, it, expect } from "vitest";
import { agentBurstTiming } from "./scheduler";

describe("tiempos del turno del agente (ventana de silencio)", () => {
  const t0 = new Date("2026-09-15T16:00:00.000Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("el turno se agenda un tic (15 s) antes de que cierre la ventana de 60 s", () => {
    const { runAt } = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: 300, now: t0 });
    expect(runAt.toISOString()).toBe(at(45).toISOString());
  });

  it("cada mensaje nuevo reprograma: el turno se corre a 45 s del ULTIMO mensaje", () => {
    const second = agentBurstTiming({ lastMessageAt: at(20), bundleWindowSeconds: 60, maxWaitSeconds: 300, now: at(20) });
    const third = agentBurstTiming({ lastMessageAt: at(30), bundleWindowSeconds: 60, maxWaitSeconds: 300, now: at(30) });
    expect(second.runAt.toISOString()).toBe(at(65).toISOString());
    expect(third.runAt.toISOString()).toBe(at(75).toISOString());
  });

  it("el tope se calcula desde el primer mensaje y la base lo congela (push_debounced_job)", () => {
    const first = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: 180, now: t0 });
    // El turno arranca un tic antes del tope: 180 - 15.
    expect(first.deadline?.toISOString()).toBe(at(165).toISOString());
  });

  it("sin tope configurado no hay deadline", () => {
    expect(agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: null, now: t0 }).deadline).toBeNull();
  });

  it("nunca se agenda en el pasado", () => {
    const { runAt } = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 15, maxWaitSeconds: null, now: at(10) });
    expect(runAt.getTime()).toBeGreaterThanOrEqual(at(10).getTime());
  });
});
