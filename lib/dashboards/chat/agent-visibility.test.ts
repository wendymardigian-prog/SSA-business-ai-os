import { describe, expect, it } from "vitest";
import { agentSectionVisibility } from "@/lib/dashboards/chat/agent-visibility";

const on = { isEnabled: true, provider: "anthropic", model: "m", channelCount: 1 };
const onNoChannels = { ...on, channelCount: 0 };
const off = { isEnabled: false, provider: "anthropic", model: "m", channelCount: 1 };

describe("seccion del agente en el dashboard del chat", () => {
  it("sin IA conectada y el agente nunca actuo: oculta", () => {
    expect(agentSectionVisibility({ agents: [], connectedProviders: [], everActed: false })).toEqual({ mode: "hidden", warning: null });
    expect(agentSectionVisibility({ agents: [off], connectedProviders: [], everActed: false }).mode).toBe("hidden");
    expect(agentSectionVisibility({ agents: [on], connectedProviders: [], everActed: false }).mode).toBe("hidden");
  });

  it("hay IA pero el agente nunca se encendio: oculta (sin invitacion)", () => {
    expect(agentSectionVisibility({ agents: [off], connectedProviders: ["anthropic"], everActed: false }).mode).toBe("hidden");
    expect(agentSectionVisibility({ agents: [], connectedProviders: ["anthropic"], everActed: false }).mode).toBe("hidden");
  });

  it("encendido pero sin ningun canal: no esta conversando, oculta", () => {
    expect(agentSectionVisibility({ agents: [onNoChannels], connectedProviders: ["anthropic"], everActed: false }).mode).toBe("hidden");
  });

  it("encendido con un canal y puede responder: completa, aunque todavia no haya actuado", () => {
    expect(agentSectionVisibility({ agents: [on], connectedProviders: ["anthropic"], everActed: false })).toEqual({ mode: "full", warning: null });
    expect(agentSectionVisibility({ agents: [off, on], connectedProviders: ["anthropic"], everActed: true }).mode).toBe("full");
  });

  it("actuo alguna vez y hoy esta apagado: completa, los numeros del periodo siguen siendo reales", () => {
    expect(agentSectionVisibility({ agents: [off], connectedProviders: ["anthropic"], everActed: true })).toEqual({ mode: "full", warning: null });
  });

  it("actuo alguna vez y se desconecto la IA: completa con un aviso (no informacion enganosa)", () => {
    const none = agentSectionVisibility({ agents: [on], connectedProviders: [], everActed: true });
    expect(none.mode).toBe("full-with-warning");
    expect(none.warning).toMatch(/ninguna IA conectada/);
    expect(agentSectionVisibility({ agents: [off], connectedProviders: [], everActed: true }).mode).toBe("full-with-warning");
  });

  it("encendido con canales pero su IA no esta conectada: completa con aviso", () => {
    const other = agentSectionVisibility({ agents: [on], connectedProviders: ["openai"], everActed: false });
    expect(other.mode).toBe("full-with-warning");
    expect(other.warning).toMatch(/no está conectada/);
  });

  it("si uno de varios agentes encendidos puede responder, la seccion va completa y sin aviso", () => {
    const a = { isEnabled: true, provider: "openai", model: "m", channelCount: 2 };
    expect(agentSectionVisibility({ agents: [on, a], connectedProviders: ["openai"], everActed: true })).toEqual({ mode: "full", warning: null });
  });

  it("es solo visibilidad: no cambia los agentes que recibe", () => {
    const agents = [{ ...on }];
    agentSectionVisibility({ agents, connectedProviders: [], everActed: true });
    expect(agents).toEqual([on]);
  });

  it("al reconectar la IA, la seccion vuelve sola", () => {
    expect(agentSectionVisibility({ agents: [on], connectedProviders: [], everActed: true }).mode).toBe("full-with-warning");
    expect(agentSectionVisibility({ agents: [on], connectedProviders: ["anthropic"], everActed: true }).mode).toBe("full");
  });
});
