import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));

const { aiSdkGenerate, TruncatedOutputError, usageOfFailure } = await import("./ai-generate");

const schema = z.object({ ok: z.boolean() });

describe("calls/ai-generate", () => {
  beforeEach(() => {
    generateObject.mockReset();
  });

  it("con Anthropic pide la salida por herramienta JSON (el análisis tiene más de 24 campos opcionales)", async () => {
    generateObject.mockResolvedValue({ object: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });
    const out = await aiSdkGenerate({} as never)({ system: "s", prompt: "p", schema, maxOutputTokens: 100 });
    expect(out.object).toEqual({ ok: true });
    const arg = generateObject.mock.calls[0][0];
    expect(arg.providerOptions).toEqual({ anthropic: { structuredOutputMode: "jsonTool" }, openai: { strictJsonSchema: false } });
    expect(arg.maxOutputTokens).toBe(100);
  });

  it("una respuesta cortada lanza TruncatedOutputError con lo que se gastó", async () => {
    generateObject.mockRejectedValue(Object.assign(new Error("no object"), { finishReason: "length", usage: { inputTokens: 28_000, outputTokens: 600 } }));
    const err = await aiSdkGenerate({} as never)({ system: "s", prompt: "p", schema }).catch((e) => e);
    expect(err).toBeInstanceOf(TruncatedOutputError);
    expect(usageOfFailure(err)).toEqual({ inputTokens: 28_000, outputTokens: 600 });
  });

  it("otro error se relanza tal cual", async () => {
    const boom = new Error("429");
    generateObject.mockRejectedValue(boom);
    await expect(aiSdkGenerate({} as never)({ system: "s", prompt: "p", schema })).rejects.toBe(boom);
  });

  it("usageOfFailure: sin dato, undefined", () => {
    expect(usageOfFailure(new Error("x"))).toBeUndefined();
    expect(usageOfFailure(null)).toBeUndefined();
    expect(usageOfFailure(new TruncatedOutputError())).toBeUndefined();
  });
});
