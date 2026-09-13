import { describe, it, expect } from "vitest";
import { resolveAgentState, toAgentConfig, isPaused } from "./config";
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

  it("toggle de la conversacion apagado", () => {
    expect(
      resolveAgentState({ agents: [agent], channelId: "ch-ig", conversation: { ...on, agent_enabled: false }, now: NOW })
        .state,
    ).toBe("conversation_off");
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
