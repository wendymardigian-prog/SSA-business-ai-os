import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const listConnectedAiProviders = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders }));

import { loadAutomationCapabilities } from "./capabilities";

const WS = "ws-1";

function world(over: { email?: boolean; channels?: Array<Record<string, unknown>>; agents?: Array<Record<string, unknown>> } = {}) {
  return memoryDb({
    integration_configs: over.email === false ? [] : [{ workspace_id: WS, type: "email_provider", provider: "resend", is_active: true }],
    channels: over.channels ?? [],
    agents: over.agents ?? [],
  }).client;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  listConnectedAiProviders.mockResolvedValue([]);
});

describe("que conexiones tiene el negocio", () => {
  it("un negocio vacio no tiene nada conectado", async () => {
    expect(await loadAutomationCapabilities(world({ email: false }), WS)).toEqual({ email: false, whatsapp_channel: false, ai: false, agent: false, channel: false });
  });

  it("email: Resend activo", async () => {
    expect((await loadAutomationCapabilities(world(), WS)).email).toBe(true);
  });

  it("IA: cualquier proveedor de texto conectado", async () => {
    listConnectedAiProviders.mockResolvedValue([{ provider: "anthropic" }]);
    expect((await loadAutomationCapabilities(world(), WS)).ai).toBe(true);
  });

  it("canal: cualquiera activo; WhatsApp: solo Evolution activo con su instancia", async () => {
    const ig = { platform: "instagram", provider: "zernio", evolution_instance: null, workspace_id: WS, is_active: true };
    const waSinInstancia = { platform: "whatsapp", provider: "evolution", evolution_instance: null, workspace_id: WS, is_active: true };
    const waOk = { platform: "whatsapp", provider: "evolution", evolution_instance: "ssa-x", workspace_id: WS, is_active: true };
    const caps1 = await loadAutomationCapabilities(world({ channels: [ig, waSinInstancia] }), WS);
    expect(caps1).toMatchObject({ channel: true, whatsapp_channel: false });
    const caps2 = await loadAutomationCapabilities(world({ channels: [ig, waOk] }), WS);
    expect(caps2).toMatchObject({ channel: true, whatsapp_channel: true });
  });

  it("un canal desconectado no cuenta", async () => {
    const off = { platform: "whatsapp", provider: "evolution", evolution_instance: "ssa-x", workspace_id: WS, is_active: false };
    expect(await loadAutomationCapabilities(world({ channels: [off] }), WS)).toMatchObject({ channel: false, whatsapp_channel: false });
  });

  it("agente: hace falta uno que converse (el copywriter no cuenta)", async () => {
    const copy = { type: "copywriter", workspace_id: WS, deleted_at: null };
    const chat = { type: "chat", workspace_id: WS, deleted_at: null };
    expect((await loadAutomationCapabilities(world({ agents: [copy] }), WS)).agent).toBe(false);
    expect((await loadAutomationCapabilities(world({ agents: [copy, chat] }), WS)).agent).toBe(true);
  });

  it("si una lectura falla, esa conexion se da por buena (un error no bloquea una automatizacion que si podia correr)", async () => {
    listConnectedAiProviders.mockRejectedValue(new Error("se cayo"));
    const caps = await loadAutomationCapabilities(world({ email: false }), WS);
    expect(caps.ai).toBe(true);
    expect(caps.email).toBe(false);
  });
});
