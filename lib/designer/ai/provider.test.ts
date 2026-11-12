import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock("@/lib/ai/provider", () => ({ getWorkspaceModel: vi.fn() }));

const { aiSdkDesignerGenerate, DESIGNER_PROVIDER_OPTIONS } = await import("./provider");

describe("ai/provider: aiSdkDesignerGenerate", () => {
  beforeEach(() => generateObject.mockReset());

  it("con Anthropic pide la salida por herramienta JSON (la nativa acepta hasta 24 campos opcionales)", async () => {
    generateObject.mockResolvedValue({ object: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });
    const generate = aiSdkDesignerGenerate({} as never);
    const out = await generate({ system: "s", text: "t", images: [], schema: z.object({ ok: z.boolean() }) });
    expect(out.object).toEqual({ ok: true });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].providerOptions).toEqual({ anthropic: { structuredOutputMode: "jsonTool" } });
    expect(DESIGNER_PROVIDER_OPTIONS).toEqual({ anthropic: { structuredOutputMode: "jsonTool" } });
  });
});
