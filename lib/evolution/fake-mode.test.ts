import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evolutionFakeEnabled, evolutionFakeFetch, fakeEvolutionConfig, FAKE_EVOLUTION_URL } from "./fake-mode";
import { failNext, fakeEvolutionState, resetFakeEvolution } from "./testing/fake-evolution";
import { checkWhatsappNumber, EvolutionError, resetVersionCache, sendText } from "@/lib/evolution-client";

/**
 * El candado del WhatsApp simulado (`EVOLUTION_FAKE_API`): solo fuera de producción. En producción se ignora SIEMPRE,
 * aunque la variable esté puesta. Con el simulado prendido, nada sale de la PC.
 */
describe("EVOLUTION_FAKE_API", () => {
  beforeEach(() => {
    resetFakeEvolution();
    resetVersionCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("solo con la variable en «1» y fuera de producción", () => {
    expect(evolutionFakeEnabled({ EVOLUTION_FAKE_API: "1", NODE_ENV: "development" })).toBe(true);
    expect(evolutionFakeEnabled({ EVOLUTION_FAKE_API: "1", NODE_ENV: "test" })).toBe(true);
    expect(evolutionFakeEnabled({ EVOLUTION_FAKE_API: "1", NODE_ENV: "production" })).toBe(false);
    expect(evolutionFakeEnabled({ EVOLUTION_FAKE_API: "true", NODE_ENV: "development" })).toBe(false);
    expect(evolutionFakeEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(evolutionFakeFetch({ EVOLUTION_FAKE_API: "1", NODE_ENV: "production" })).toBeUndefined();
    expect(fakeEvolutionConfig({ EVOLUTION_FAKE_API: "1", NODE_ENV: "production" })).toBeNull();
  });

  it("la configuración simulada no lleva ninguna clave real", () => {
    const config = fakeEvolutionConfig({ EVOLUTION_FAKE_API: "1", NODE_ENV: "development" });
    expect(config?.baseUrl).toBe(FAKE_EVOLUTION_URL);
    expect(config?.apiKey).toBe("simulado");
  });

  it("en producción, con la variable puesta, el pedido va al fetch de verdad", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVOLUTION_FAKE_API", "1");
    const real = vi.fn(async () => new Response(JSON.stringify({ key: { id: "REAL1" } }), { status: 201 }));
    vi.stubGlobal("fetch", real);
    const sent = await sendText({ baseUrl: "https://evo.example", apiKey: "k", instancePrefix: "ssa" }, "inst", "34600111222", "hola");
    expect(sent.id).toBe("REAL1");
    expect(real).toHaveBeenCalled();
    expect(fakeEvolutionState().sent).toHaveLength(0);
  });

  it("en desarrollo, con la variable puesta, responde el simulado, lo anota y no sale nada", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EVOLUTION_FAKE_API", "1");
    const real = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", real);
    const config = fakeEvolutionConfig()!;
    const sent = await sendText(config, "inst", "34600111222", "hola");
    expect(sent.id).toMatch(/^SIM/);
    expect(real).not.toHaveBeenCalled();
    expect(fakeEvolutionState().sent).toEqual([expect.objectContaining({ to: "34600111222", text: "hola", kind: "text" })]);
  });

  it("escenarios: rechazo (4004), sin WhatsApp (0000) y fallos programados", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EVOLUTION_FAKE_API", "1");
    vi.stubGlobal("fetch", vi.fn());
    const config = fakeEvolutionConfig()!;
    await expect(sendText(config, "inst", "34600114004", "x")).rejects.toMatchObject({ status: 400 });
    expect(await checkWhatsappNumber(config, "inst", "34600110000")).toMatchObject({ exists: false });
    expect(await checkWhatsappNumber(config, "inst", "34600111222")).toMatchObject({ exists: true });
    failNext("34600111222", 404, 1);
    const err = await sendText(config, "inst", "34600111222", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvolutionError);
    expect((err as EvolutionError).status).toBe(404);
    expect((await sendText(config, "inst", "34600111222", "x")).id).toMatch(/^SIM/);
  });
});
