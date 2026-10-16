import { describe, expect, it } from "vitest";
import { agentSectionVisibility } from "@/lib/dashboards/chat/agent-visibility";

const on = { isEnabled: true, provider: "anthropic", model: "m" };
const off = { isEnabled: false, provider: "anthropic", model: "m" };

describe("seccion del agente en el dashboard del chat", () => {
  it("sin IA conectada y sin agentes encendidos: oculta", () => {
    expect(agentSectionVisibility({ agents: [], connectedProviders: [] })).toEqual({ mode: "hidden", warning: null });
    expect(agentSectionVisibility({ agents: [off], connectedProviders: [] }).mode).toBe("hidden");
  });

  it("hay IA pero ningun agente encendido: invitacion a encender (no cinco tarjetas vacias)", () => {
    expect(agentSectionVisibility({ agents: [off], connectedProviders: ["anthropic"] }).mode).toBe("invite");
    expect(agentSectionVisibility({ agents: [], connectedProviders: ["anthropic"] }).mode).toBe("invite");
  });

  it("al menos un agente encendido que puede responder: completa", () => {
    expect(agentSectionVisibility({ agents: [on], connectedProviders: ["anthropic"] })).toEqual({ mode: "full", warning: null });
    expect(agentSectionVisibility({ agents: [off, on], connectedProviders: ["anthropic"] }).mode).toBe("full");
  });

  it("encendido pero se desconecto la IA: completa con un aviso (no informacion enganosa)", () => {
    const none = agentSectionVisibility({ agents: [on], connectedProviders: [] });
    expect(none.mode).toBe("full-with-warning");
    expect(none.warning).toMatch(/ninguna IA conectada/);
    const other = agentSectionVisibility({ agents: [on], connectedProviders: ["openai"] });
    expect(other.mode).toBe("full-with-warning");
    expect(other.warning).toMatch(/no está conectada/);
  });

  it("si uno de varios agentes encendidos puede responder, la seccion va completa y sin aviso", () => {
    const a = { isEnabled: true, provider: "openai", model: "m" };
    expect(agentSectionVisibility({ agents: [on, a], connectedProviders: ["openai"] })).toEqual({ mode: "full", warning: null });
  });

  it("es solo visibilidad: no cambia los agentes que recibe", () => {
    const agents = [{ ...on }];
    agentSectionVisibility({ agents, connectedProviders: [] });
    expect(agents).toEqual([on]);
  });

  it("al reconectar la IA, la seccion vuelve sola", () => {
    expect(agentSectionVisibility({ agents: [on], connectedProviders: [] }).mode).toBe("full-with-warning");
    expect(agentSectionVisibility({ agents: [on], connectedProviders: ["anthropic"] }).mode).toBe("full");
  });
});
