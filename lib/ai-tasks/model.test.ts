import { beforeEach, describe, expect, it, vi } from "vitest";

const exact = vi.fn();
const byDefault = vi.fn();
vi.mock("@/lib/ai/provider", () => ({
  getExactWorkspaceModel: (...args: unknown[]) => exact(...args),
  getWorkspaceModel: (...args: unknown[]) => byDefault(...args),
}));

import { loadTaskModel, parseTaskModels, resolveTaskModel, taskModelOf } from "./model";

/** Cliente falso minimo: `workspaces.select(...).eq(...).maybeSingle()`. */
function client(result: { data: unknown; error: unknown } | "throw") {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result === "throw") throw new Error("red caida");
            return result;
          },
        }),
      }),
    }),
  } as never;
}

beforeEach(() => {
  exact.mockReset();
  byDefault.mockReset();
});

describe("parseTaskModels", () => {
  it("lee proveedor y modelo de cada tarea", () => {
    expect(parseTaskModels({ ads_analysis: { provider: "anthropic", model: "claude-haiku-4-5" } })).toEqual({
      ads_analysis: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
  });

  it("ignora lo roto en vez de lanzar", () => {
    expect(parseTaskModels(null)).toEqual({});
    expect(parseTaskModels([])).toEqual({});
    expect(parseTaskModels("x")).toEqual({});
    expect(
      parseTaskModels({
        a: { provider: "openai" },
        b: { model: "gpt" },
        c: { provider: "  ", model: "gpt" },
        d: 5,
        e: { provider: " openai ", model: " gpt-5 " },
      }),
    ).toEqual({ e: { provider: "openai", model: "gpt-5" } });
  });

  it("taskModelOf: la de la tarea, o null", () => {
    const raw = { ads_analysis: { provider: "openai", model: "gpt-5" } };
    expect(taskModelOf(raw, "ads_analysis")).toEqual({ provider: "openai", model: "gpt-5" });
    expect(taskModelOf(raw, "media_description")).toBeNull();
  });
});

describe("loadTaskModel", () => {
  it("nunca lanza: un error de lectura es 'usa el del negocio'", async () => {
    expect(await loadTaskModel(client("throw"), "ws", "ads_analysis")).toBeNull();
    expect(await loadTaskModel(client({ data: null, error: { message: "x" } }), "ws", "ads_analysis")).toBeNull();
  });
});

describe("resolveTaskModel", () => {
  const chosen = { data: { ai_task_models: { ads_analysis: { provider: "openai", model: "gpt-5" } } }, error: null };

  it("con modelo elegido, pide EXACTAMENTE ese proveedor y modelo", async () => {
    exact.mockResolvedValue({ ok: true, provider: "openai", modelId: "gpt-5", model: {} });
    const result = await resolveTaskModel(client(chosen), "ws", "ads_analysis");

    expect(exact).toHaveBeenCalledWith("ws", expect.objectContaining({ provider: "openai", modelId: "gpt-5" }));
    expect(byDefault).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, chosen: true });
  });

  it("si el proveedor elegido ya no esta conectado, falla: no cambia de modelo en silencio", async () => {
    exact.mockResolvedValue({ ok: false, problem: "provider_unavailable", message: 'El proveedor "openai" no esta conectado.' });
    const result = await resolveTaskModel(client(chosen), "ws", "ads_analysis");

    expect(result.ok).toBe(false);
    expect(result.chosen).toBe(true);
    expect(byDefault).not.toHaveBeenCalled();
  });

  it("sin eleccion, usa el modelo del negocio como siempre", async () => {
    byDefault.mockResolvedValue({ ok: true, provider: "anthropic", modelId: "claude-haiku-4-5", model: {} });
    const result = await resolveTaskModel(client({ data: { ai_task_models: {} }, error: null }), "ws", "ads_analysis");

    expect(exact).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, chosen: false, provider: "anthropic" });
  });

  it("si no se puede leer lo elegido, corre con el del negocio", async () => {
    byDefault.mockResolvedValue({ ok: true, provider: "anthropic", modelId: "m", model: {} });
    const result = await resolveTaskModel(client("throw"), "ws", "ads_analysis");
    expect(result.chosen).toBe(false);
    expect(result.ok).toBe(true);
  });
});
