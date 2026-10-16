import { describe, expect, it } from "vitest";
import { agentAvailability, availabilityBadge, providerName } from "@/lib/agent/availability";

const chat = { conversational: true, provider: "anthropic", model: "m" };

describe("disponibilidad de un agente", () => {
  it("encendido, con modelo y su proveedor conectado: activo", () => {
    const a = agentAvailability({ ...chat, isEnabled: true, connectedProviders: ["anthropic", "openai"] });
    expect(a).toEqual({ state: "active", blockedBy: null, canEnable: true, message: null });
  });

  it("apagado y sin bloqueos: apagado, y se puede encender", () => {
    const a = agentAvailability({ ...chat, isEnabled: false, connectedProviders: ["anthropic"] });
    expect(a).toMatchObject({ state: "off", blockedBy: null, canEnable: true });
  });

  it("sin ninguna IA conectada: no se puede encender y dice por que", () => {
    const a = agentAvailability({ ...chat, isEnabled: false, connectedProviders: [] });
    expect(a).toMatchObject({ state: "off", blockedBy: "no_provider", canEnable: false });
    expect(a.message).toMatch(/ninguna IA conectada/i);
  });

  it("encendido pero sin IA conectada: bloqueado (no se apaga: la configuracion no se toca)", () => {
    const a = agentAvailability({ ...chat, isEnabled: true, connectedProviders: [] });
    expect(a).toMatchObject({ state: "blocked", blockedBy: "no_provider", canEnable: false });
  });

  it("se desconecto el proveedor de ESTE agente pero hay otra IA: bloqueado y nombra la que falta", () => {
    const a = agentAvailability({ ...chat, isEnabled: true, connectedProviders: ["openai"] });
    expect(a).toMatchObject({ state: "blocked", blockedBy: "provider_disconnected" });
    expect(a.message).toMatch(/Anthropic/);
  });

  it("reconectar el proveedor lo deja activo otra vez, sin tocar nada mas", () => {
    const input = { ...chat, isEnabled: true };
    expect(agentAvailability({ ...input, connectedProviders: [] }).state).toBe("blocked");
    expect(agentAvailability({ ...input, connectedProviders: ["anthropic"] }).state).toBe("active");
  });

  it("un agente de chat sin modelo elegido no se puede encender", () => {
    const a = agentAvailability({ conversational: true, provider: null, model: null, isEnabled: false, connectedProviders: ["anthropic"] });
    expect(a).toMatchObject({ blockedBy: "no_model", canEnable: false });
  });

  it("el copywriter usa el modelo del negocio: le alcanza con que haya cualquier IA", () => {
    const copy = { conversational: false, provider: null, model: null };
    expect(agentAvailability({ ...copy, isEnabled: false, connectedProviders: ["openai"] })).toMatchObject({ canEnable: true, blockedBy: null });
    expect(agentAvailability({ ...copy, isEnabled: true, connectedProviders: ["openai"] }).state).toBe("active");
    expect(agentAvailability({ ...copy, isEnabled: true, connectedProviders: [] }).blockedBy).toBe("no_provider");
  });
});

describe("textos", () => {
  it("la etiqueta del estado distingue encendido de encendido-pero-bloqueado", () => {
    expect(availabilityBadge(agentAvailability({ ...chat, isEnabled: true, connectedProviders: ["anthropic"] }))).toEqual({ label: "Encendido", tone: "ok" });
    expect(availabilityBadge(agentAvailability({ ...chat, isEnabled: true, connectedProviders: [] })).tone).toBe("warn");
    expect(availabilityBadge(agentAvailability({ ...chat, isEnabled: false, connectedProviders: [] })).label).toBe("Apagado");
  });

  it("providerName", () => {
    expect(providerName("google_ai")).toBe("Google");
    expect(providerName("otro")).toBe("otro");
    expect(providerName(null)).toBe("la IA");
  });
});

describe("agentsLeftWithoutAi", () => {
  const agents = [
    { name: "Atención", isEnabled: true, provider: "anthropic", model: "m", conversational: true },
    { name: "Ventas", isEnabled: true, provider: "openai", model: "m", conversational: true },
    { name: "Apagado", isEnabled: false, provider: "anthropic", model: "m", conversational: true },
    { name: "Copywriter", isEnabled: true, provider: null, model: null, conversational: false },
  ];

  it("al desconectar Anthropic quedan sin IA solo los encendidos que la usaban", async () => {
    const { agentsLeftWithoutAi } = await import("@/lib/agent/availability");
    expect(agentsLeftWithoutAi(agents, ["openai"])).toEqual(["Atención"]);
  });

  it("al quedar sin ninguna IA, quedan todos los encendidos (el copywriter tambien)", async () => {
    const { agentsLeftWithoutAi } = await import("@/lib/agent/availability");
    expect(agentsLeftWithoutAi(agents, [])).toEqual(["Atención", "Ventas", "Copywriter"]);
  });

  it("si todo sigue conectado no hay a quien avisar", async () => {
    const { agentsLeftWithoutAi } = await import("@/lib/agent/availability");
    expect(agentsLeftWithoutAi(agents, ["anthropic", "openai"])).toEqual([]);
  });
});
