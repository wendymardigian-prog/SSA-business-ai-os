/**
 * La generacion de copy contra el proveedor, simulado (F29).
 *
 * No se llama a ningun modelo: `generateObject` esta mockeado. Lo que se
 * prueba es lo que decide el sistema alrededor de la llamada, que es donde
 * estan los errores caros: que no se llame si no hay proveedor, que no se
 * llame si el workspace llego a su tope, y que el costo quede registrado en
 * el workspace que lo pidio.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { generateObject, getWorkspaceModel, openAiRun } = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getWorkspaceModel: vi.fn(),
  openAiRun: vi.fn(),
}));

vi.mock("ai", () => ({ generateObject }));
vi.mock("@/lib/ai/provider", () => ({ getWorkspaceModel }));
vi.mock("@/lib/ai/run", () => ({ openAiRun }));

import { generateCopy } from "./generate-copy";

const WS = "ws-1";

const salida = {
  copy: { hook: "Un hook", body: "El desarrollo", cta: "Comenta SISTEMA", recording_notes: "" },
  caption_base: "Un caption",
  captions: { instagram: "Para Instagram" },
  youtube_title: null,
};

/** Un handle de run que anota como se cerro. */
function fakeRun() {
  const closed: Array<Record<string, unknown>> = [];
  const steps: Array<Record<string, unknown>> = [];
  return {
    closed,
    steps,
    handle: {
      runId: "run-1",
      setModel: vi.fn(),
      setFinalUsage: vi.fn(),
      addStepUsage: vi.fn(),
      addEmbeddingUsage: vi.fn(),
      setRouting: vi.fn(),
      setIntent: vi.fn(),
      step: vi.fn(async (input: Record<string, unknown>) => {
        steps.push(input);
        return "step-1";
      }),
      close: vi.fn(async (input: Record<string, unknown>) => {
        closed.push(input);
        return { costUsd: 0.004, pricingMissing: false };
      }),
    },
  };
}

function db(over: Record<string, unknown> = {}) {
  return memoryDb(
    {
      workspaces: [
        {
          id: WS,
          ai_daily_cost_limit_usd: null,
          ai_monthly_cost_limit_usd: null,
          ...over,
        },
      ],
    },
    { rpc: { sum_ai_spend: () => 0 } },
  );
}

const request = { title: "Como cobrar", platforms: ["instagram"] };

let run: ReturnType<typeof fakeRun>;

beforeEach(() => {
  vi.clearAllMocks();
  run = fakeRun();
  openAiRun.mockResolvedValue(run.handle);
  getWorkspaceModel.mockResolvedValue({
    ok: true,
    model: { id: "modelo" },
    provider: "anthropic",
    modelId: "claude-sonnet-5",
  });
  generateObject.mockResolvedValue({ object: salida, usage: { inputTokens: 100, outputTokens: 200 } });
});

describe("generar el copy", () => {
  it("devuelve el guion, los captions y lo que costo", async () => {
    const result = await generateCopy(db().client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.copy.hook).toBe("Un hook");
    expect(result.costUsd).toBe(0.004);
  });

  it("el run se abre con la fuente content_copy: asi el costo entra al total", async () => {
    await generateCopy(db().client, { workspaceId: WS, userId: "u1", postId: "p1", request });

    expect(openAiRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, source: "content_copy" }),
    );
    expect(run.closed[0]).toMatchObject({ status: "responded" });
  });

  it("el paso del run no guarda el texto generado, solo metadatos", async () => {
    await generateCopy(db().client, { workspaceId: WS, userId: "u1", postId: "p1", request });

    expect(JSON.stringify(run.steps)).not.toContain("El desarrollo");
  });

  it("sin proveedor conectado no se llama al modelo y se dice donde conectarlo", async () => {
    getWorkspaceModel.mockResolvedValue({ ok: false, problem: "no_provider" });

    const result = await generateCopy(db().client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result).toMatchObject({ ok: false, reason: "no_provider" });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("con el tope de gasto alcanzado NO se llama al modelo", async () => {
    // Sin este chequeo, el tope dejaria de significar algo.
    const database = memoryDb(
      { workspaces: [{ id: WS, ai_daily_cost_limit_usd: 5, ai_monthly_cost_limit_usd: null }] },
      { rpc: { sum_ai_spend: () => 7 } },
    );

    const result = await generateCopy(database.client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result).toMatchObject({ ok: false, reason: "spend_limit" });
    expect(generateObject).not.toHaveBeenCalled();
    expect(openAiRun).not.toHaveBeenCalled();
  });

  it("debajo del tope si se genera", async () => {
    const database = memoryDb(
      { workspaces: [{ id: WS, ai_daily_cost_limit_usd: 5, ai_monthly_cost_limit_usd: null }] },
      { rpc: { sum_ai_spend: () => 1 } },
    );

    const result = await generateCopy(database.client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result.ok).toBe(true);
  });

  it("si no se puede leer el gasto, no se genera: del lado seguro", async () => {
    const database = memoryDb({
      workspaces: [{ id: WS, ai_daily_cost_limit_usd: 5, ai_monthly_cost_limit_usd: null }],
    });

    const result = await generateCopy(database.client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result.ok).toBe(false);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("si el modelo devuelve algo que no sirve, el run queda en error y no se guarda nada", async () => {
    generateObject.mockResolvedValue({
      object: { copy: { hook: "", body: "", cta: "", recording_notes: "" }, caption_base: "", captions: {} },
      usage: {},
    });

    const result = await generateCopy(db().client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(run.closed[0]).toMatchObject({ status: "error", statusDetail: "invalid_output" });
  });

  it("si el proveedor falla, el run queda en error y el mensaje es legible", async () => {
    generateObject.mockRejectedValue(new Error("401 invalid api key"));

    const result = await generateCopy(db().client, {
      workspaceId: WS, userId: "u1", postId: "p1", request,
    });

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    if (result.ok) return;
    // Hacia afuera no viaja el detalle del proveedor.
    expect(result.error).not.toContain("401");
    expect(run.closed[0]).toMatchObject({ status: "error" });
  });
});
