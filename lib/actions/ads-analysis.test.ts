/**
 * "Analizar con IA" como tarea de Agentes IA: usa las instrucciones activas y
 * el modelo de la tarea. Todo simulado: no hay llamada real a ningun proveedor.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));

const resolveTaskModel = vi.fn();
vi.mock("@/lib/ai-tasks/model", () => ({ resolveTaskModel: (...args: unknown[]) => resolveTaskModel(...args) }));

const loadTaskInstructions = vi.fn();
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: (...args: unknown[]) => loadTaskInstructions(...args) }));

const openAiRun = vi.fn();
vi.mock("@/lib/ai/run", () => ({ openAiRun: (...args: unknown[]) => openAiRun(...args) }));

vi.mock("@/lib/ai/workspace-budget", () => ({ withinWorkspaceBudget: async () => ({ allowed: true }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));
vi.mock("@/lib/dashboards/ads-load", () => ({
  loadAdsInsights: async () => [
    { level: "account", objectId: "act_1", date: "2026-10-01", spend: 50, impressions: 1000, clicks: 20, leads: 2, actions: {} },
  ],
}));
vi.mock("@/lib/auth/guards", () => ({
  requireWorkspaceAdmin: async () => ({
    workspace: { id: "ws-1", timezone: "UTC" },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { config: { ad_accounts: [{ ad_account_id: "act_1", name: "Cuenta", currency: "USD", sync_enabled: true }] } },
                }),
              }),
            }),
          }),
        }),
      }),
    },
  }),
}));

import { analyzeAdsWithAi } from "./ads-analysis";

function fakeRun() {
  return {
    setModel: vi.fn(),
    setFinalUsage: vi.fn(),
    step: vi.fn(async () => undefined),
    close: vi.fn(async () => ({ costUsd: 0.01 })),
  };
}

beforeEach(() => {
  generateText.mockReset();
  resolveTaskModel.mockReset();
  loadTaskInstructions.mockReset();
  openAiRun.mockReset();
});

describe("analyzeAdsWithAi", () => {
  it("manda como system prompt las instrucciones activas y deja anotada su version", async () => {
    const run = fakeRun();
    openAiRun.mockResolvedValue(run);
    loadTaskInstructions.mockResolvedValue({ version: 3, text: "Resumí en tres puntos. Hablá en {{estilo}}." });
    resolveTaskModel.mockResolvedValue({ ok: true, model: {}, provider: "openai", modelId: "gpt-5", chosen: true });
    generateText.mockResolvedValue({ text: "Analisis", usage: {} });

    const result = await analyzeAdsWithAi({ period: "30d" });

    expect(generateText.mock.calls[0][0].system).toMatch(/^Resumí en tres puntos\. Hablá en .+\.$/);
    expect(generateText.mock.calls[0][0].system).not.toContain("{{estilo}}");
    expect(openAiRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "ads_analysis", promptVersion: 3 }));
    expect(run.setModel).toHaveBeenCalledWith("openai", "gpt-5");
    expect(result).toEqual({ ok: true, text: "Analisis", costUsd: 0.01, model: "openai/gpt-5" });
  });

  it("sin instrucciones editadas, usa el texto del sistema (version null)", async () => {
    openAiRun.mockResolvedValue(fakeRun());
    loadTaskInstructions.mockResolvedValue({ version: null, text: "Sos un analista de medios pagos que trabaja para este negocio." });
    resolveTaskModel.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "claude-haiku-4-5", chosen: false });
    generateText.mockResolvedValue({ text: "ok", usage: {} });

    await analyzeAdsWithAi({});

    expect(openAiRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ promptVersion: null }));
    expect(generateText.mock.calls[0][0].system).toContain("analista de medios pagos");
  });

  it("si el modelo elegido ya no esta disponible, no llama al modelo y dice donde cambiarlo", async () => {
    loadTaskInstructions.mockResolvedValue({ version: null, text: "x" });
    resolveTaskModel.mockResolvedValue({ ok: false, chosen: true, message: 'El proveedor "openai" no esta conectado.' });

    const result = await analyzeAdsWithAi({});

    expect(generateText).not.toHaveBeenCalled();
    expect(openAiRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("Agentes IA → Análisis de anuncios");
  });

  it("sin un modelo elegido y sin proveedor conectado, manda a Integraciones", async () => {
    loadTaskInstructions.mockResolvedValue({ version: null, text: "x" });
    resolveTaskModel.mockResolvedValue({ ok: false, chosen: false, message: "No hay ningun proveedor de IA conectado." });

    const result = await analyzeAdsWithAi({});

    expect(result.ok === false && result.error).toBe("No hay ningun proveedor de IA conectado.");
  });

  it("si la generacion falla, cierra la corrida con error y no revela el detalle tecnico", async () => {
    const run = fakeRun();
    openAiRun.mockResolvedValue(run);
    loadTaskInstructions.mockResolvedValue({ version: null, text: "x" });
    resolveTaskModel.mockResolvedValue({ ok: true, model: {}, provider: "openai", modelId: "gpt-5", chosen: true });
    generateText.mockRejectedValue(new Error("401 invalid key sk-secret"));

    const result = await analyzeAdsWithAi({});

    expect(run.close).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(result.ok === false && result.error).not.toContain("sk-secret");
  });
});
