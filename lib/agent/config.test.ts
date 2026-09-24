import { describe, it, expect } from "vitest";
import { resolveAgentState, toAgentConfig, isPaused, toAgentMode, fromAgentMode } from "./config";
import { agentRow } from "./testing/fixtures";

const NOW = new Date("2026-09-15T16:00:00Z");
const on = { agent_enabled: true, agent_paused_until: null };

describe("estado efectivo del agente (derivado, nunca guardado)", () => {
  const agent = toAgentConfig(agentRow({ is_enabled: true, enabled_channel_ids: ["ch-ig"] }));

  it("activo con agente, canal y toggle encendidos", () => {
    expect(resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: on, now: NOW }).state).toBe("active");
  });

  it("sin agentes", () => {
    expect(resolveAgentState({ agents: [], channelId: "ch-ig", conversation: on, now: NOW }).state).toBe("no_agent");
  });

  it("maestro del canal apagado: nunca responde en ese canal, aunque el toggle este prendido", () => {
    expect(resolveAgentState({ agents: [agent], channelId: "ch-wa", conversation: on, now: NOW }).state).toBe(
      "channel_off",
    );
  });

  it("agente apagado globalmente", () => {
    const off = toAgentConfig(agentRow({ is_enabled: false, enabled_channel_ids: ["ch-ig"] }));
    expect(resolveAgentState({ agents: [off], channelId: "ch-ig", conversation: on, now: NOW }).state).toBe("agent_off");
  });

  it("forzado apagado en la conversacion: no atiende aunque el maestro este prendido", () => {
    const state = resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: { ...on, agent_enabled: false }, now: NOW });
    expect(state).toMatchObject({ state: "conversation_off", inherited: false });
  });

  describe("heredar del canal (agent_enabled NULL, el default desde la 00066)", () => {
    const inherit = { agent_enabled: null, agent_paused_until: null };

    it("con el maestro del canal prendido, la conversacion esta atendida", () => {
      expect(resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: inherit, now: NOW })).toMatchObject({
        state: "active",
        inherited: true,
      });
    });

    it("con el maestro del canal apagado, no esta atendida, y se sabe que es por herencia", () => {
      expect(resolveAgentState({ agents: [agent], channelId: "ch-wa", conversation: inherit, now: NOW })).toMatchObject({
        state: "channel_off",
        inherited: true,
      });
    });

    it("con el agente apagado globalmente, tampoco", () => {
      const off = toAgentConfig(agentRow({ is_enabled: false, enabled_channel_ids: ["ch-ig"] }));
      expect(resolveAgentState({ agents: [off], channelId: "ch-ig", conversation: inherit, now: NOW })).toMatchObject({
        state: "agent_off",
        inherited: true,
      });
    });

    it("una pausa de un flow se respeta igual en heredar", () => {
      expect(
        resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: { ...inherit, agent_paused_until: "infinity" }, now: NOW }),
      ).toMatchObject({ state: "paused", inherited: true });
    });
  });

  it("forzado prendido con el maestro prendido: activo, y no es herencia", () => {
    expect(resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: on, now: NOW })).toMatchObject({
      state: "active",
      inherited: false,
    });
  });

  it("los tres estados se traducen ida y vuelta", () => {
    expect(toAgentMode(null)).toBe("inherit");
    expect(toAgentMode(true)).toBe("on");
    expect(toAgentMode(false)).toBe("off");
    expect(fromAgentMode("inherit")).toBeNull();
    expect(fromAgentMode("on")).toBe(true);
    expect(fromAgentMode("off")).toBe(false);
  });

  it("pausado por un flow hasta que lo reanude", () => {
    expect(
      resolveAgentState({
        agents: [agent],
        channelId: "ch-ig",
        conversation: { ...on, agent_paused_until: "infinity" },
        now: NOW,
      }).state,
    ).toBe("paused");
  });

  it("una pausa vencida ya no pausa", () => {
    expect(isPaused("2026-09-15T15:00:00Z", NOW)).toBe(false);
    expect(isPaused("2026-09-15T17:00:00Z", NOW)).toBe(true);
  });

  it("un tipo de agente que no conversa (etapas futuras) nunca atiende la bandeja", () => {
    const content = toAgentConfig(agentRow({ type: "content", is_enabled: true, enabled_channel_ids: ["ch-ig"] }));
    expect(resolveAgentState({ agents: [content], channelId: "ch-ig", conversation: on, now: NOW }).state).toBe(
      "no_agent",
    );
  });

  it("un jsonb roto no rompe: se leen los defaults", () => {
    const broken = toAgentConfig(agentRow({ guardrails: { escalation: { maxUnresolvedTurns: "muchos" } } as never }));
    expect(broken.guardrails.escalation.maxUnresolvedTurns).toBe(6);
    expect(broken.guardrails.blockedTopics.enabled).toBe(true);
  });
});
