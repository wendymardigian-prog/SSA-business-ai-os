import { describe, it, expect } from "vitest";
import { computeAudioCostUsd, computeChatCostUsd, computeEmbeddingCostUsd, safeTokens } from "./pricing";

// claude-sonnet-5: USD 2 entrada, 10 salida, 0,20 lectura de cache por millon.
const SONNET = { id: "p1", input_per_mtok: 2, output_per_mtok: 10, cached_input_per_mtok: 0.2, audio_per_hour: null };

describe("costo de chat", () => {
  it("sin cache: entrada por su precio y salida por el suyo", () => {
    // 1.000.000 de entrada = 2 USD; 100.000 de salida = 1 USD.
    expect(computeChatCostUsd(SONNET, { input: 1_000_000, cachedRead: 0, output: 100_000 })).toBe(3);
  });

  it("con cache: los cacheados se cobran UNA vez, a su precio, y no tambien como entrada", () => {
    // 1.000.000 de entrada total, de los cuales 800.000 salieron de cache:
    // 200.000 x 2 + 800.000 x 0,2 = 0,40 + 0,16 = 0,56 USD.
    const cost = computeChatCostUsd(SONNET, { input: 1_000_000, cachedRead: 800_000, output: 0 });
    expect(cost).toBe(0.56);
    // Si se contaran dos veces daria 2,16.
    expect(cost).not.toBe(2.16);
  });

  it("un cacheado mayor que la entrada (dato raro del proveedor) no da costo negativo", () => {
    expect(computeChatCostUsd(SONNET, { input: 100, cachedRead: 500, output: 0 })).toBeGreaterThanOrEqual(0);
  });

  it("redondea a seis decimales, como la columna", () => {
    expect(computeChatCostUsd(SONNET, { input: 7, cachedRead: 0, output: 3 })).toBe(0.000044);
  });

  it("tokens que llegan undefined, NaN o negativos cuentan como cero, sin propagar NaN", () => {
    expect(safeTokens(undefined)).toBe(0);
    expect(safeTokens(Number.NaN)).toBe(0);
    expect(safeTokens(-5)).toBe(0);
    expect(
      computeChatCostUsd(SONNET, { input: Number.NaN, cachedRead: undefined as never, output: 1_000_000 }),
    ).toBe(10);
  });
});

describe("costo de embeddings", () => {
  it("solo entrada: voyage-4-lite a 0,02 por millon", () => {
    const voyage = { id: "v", input_per_mtok: 0.02, output_per_mtok: 0, cached_input_per_mtok: 0, audio_per_hour: null };
    expect(computeEmbeddingCostUsd(voyage, 500_000)).toBe(0.01);
  });
});

describe("costo de transcripcion (F6)", () => {
  // Groq whisper-large-v3-turbo: USD 0,04 la hora de audio.
  const GROQ = { id: "p-groq", input_per_mtok: 0, output_per_mtok: 0, cached_input_per_mtok: 0, audio_per_hour: 0.04 };

  it("se cobra por duracion: una hora de audio cuesta el precio de la hora", () => {
    expect(computeAudioCostUsd(GROQ, 3600)).toBe(0.04);
  });

  it("una nota de voz de 40 segundos cuesta una fraccion", () => {
    // 40 / 3600 * 0,04 = 0,000444
    expect(computeAudioCostUsd(GROQ, 40)).toBe(0.000444);
  });

  it("sin precio de audio cargado devuelve null, NO cero", () => {
    // Cero diria "salio gratis" y el informe mostraria un total falso.
    expect(computeAudioCostUsd(SONNET, 3600)).toBeNull();
  });

  it("segundos raros del proveedor no propagan NaN ni dan negativo", () => {
    expect(computeAudioCostUsd(GROQ, Number.NaN)).toBe(0);
    expect(computeAudioCostUsd(GROQ, -10)).toBe(0);
    expect(computeAudioCostUsd(GROQ, 0)).toBe(0);
  });

  it("OpenAI cuesta nueve veces mas, que es por lo que Groq es el principal", () => {
    const openai = { ...GROQ, id: "p-openai", audio_per_hour: 0.36 };
    expect(computeAudioCostUsd(openai, 3600)).toBe(0.36);
    expect(computeAudioCostUsd(openai, 3600)! / computeAudioCostUsd(GROQ, 3600)!).toBe(9);
  });
});
