import { describe, it, expect } from "vitest";
import { AGENT_RUN_COST_COLUMNS, AGENT_RUN_PUBLIC_COLUMNS, channelAgentInfo } from "./public";

describe("columnas publicas de agent_runs", () => {
  it("no incluyen ninguna columna de tokens ni de costo (un select con ellas falla para cualquier usuario)", () => {
    const cols = AGENT_RUN_PUBLIC_COLUMNS.split(",").map((c) => c.trim());
    for (const cost of AGENT_RUN_COST_COLUMNS) expect(cols).not.toContain(cost);
    expect(cols).not.toContain("*");
  });
});

describe("toggle de la bandeja segun el maestro del canal", () => {
  const agent = { id: "a", name: "Asistente", type: "chat", is_enabled: true, enabled_channel_ids: ["ch-ig"], deleted_at: null };

  it("canal atendido: el toggle se puede operar", () => {
    expect(channelAgentInfo([agent], { id: "ch-ig", label: "Instagram" })).toMatchObject({ available: true });
  });

  it("maestro apagado: bloqueado en off con el motivo a la vista", () => {
    const info = channelAgentInfo([agent], { id: "ch-wa", label: "WhatsApp" });
    expect(info).toMatchObject({ available: false, reason: "channel_off" });
    expect(info.message).toContain("apagado para WhatsApp");
  });

  it("agente apagado globalmente", () => {
    expect(channelAgentInfo([{ ...agent, is_enabled: false }], { id: "ch-ig", label: "Instagram" })).toMatchObject({
      available: false,
      reason: "agent_off",
    });
  });

  it("sin agente", () => {
    expect(channelAgentInfo([], { id: "ch-ig", label: "Instagram" })).toMatchObject({ reason: "no_agent" });
  });
});

describe("modo del canal en la bandeja (00070)", () => {
  const base = { id: "a-1", name: "Agente", type: "chat", is_enabled: true, enabled_channel_ids: ["ch-ig"], deleted_at: null };

  it("sin entrada, el canal envia directo", () => {
    expect(channelAgentInfo([base], { id: "ch-ig", label: "Instagram" }).mode).toBe("send");
  });
  it("en draft, la bandeja lo sabe", () => {
    const agent = { ...base, channel_modes: { "ch-ig": "draft" } };
    expect(channelAgentInfo([agent], { id: "ch-ig", label: "Instagram" }).mode).toBe("draft");
  });
});
