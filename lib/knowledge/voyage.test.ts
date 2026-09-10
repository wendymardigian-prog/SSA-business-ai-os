import { describe, it, expect, vi } from "vitest";
import {
  embedTexts,
  batchTexts,
  estimateTokens,
  isRetryable,
  toPgVector,
  EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "./voyage";

/** Un embedding valido: la dimension que espera la base. */
function vec(seed = 0): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 1 : 0));
}

/**
 * fetch falso con cola de respuestas. Mismo patron que evolution-client.test.ts.
 * Graba los requests para poder assertear que se manda lo que corresponde.
 */
function mockFetch(responses: Array<{ status: number; body?: unknown; throws?: boolean }>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  let i = 0;

  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i++;

    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      auth: headers.Authorization ?? "",
    });

    if (next.throws) throw new Error("ECONNRESET");

    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? ""),
    } as Response;
  });

  return { impl: impl as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

describe("estimateTokens y batchTexts", () => {
  it("corta los lotes por cantidad de textos", () => {
    const texts = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const batches = batchTexts(texts);

    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(128);
    // Ningun texto se pierde ni se duplica.
    expect(batches.flat()).toEqual(texts);
  });

  it("corta los lotes por tokens aunque sean pocos textos", () => {
    // Cada texto ~75k tokens estimados; no entran dos en un lote de 100k.
    const gordo = "x".repeat(300_000);
    const batches = batchTexts([gordo, gordo, gordo]);

    expect(batches.length).toBe(3);
  });

  it("un solo texto que se pasa del tope va igual, en su propio lote", () => {
    // Truncado es mejor que perder el documento entero.
    const enorme = "x".repeat(2_000_000);
    const batches = batchTexts([enorme]);

    expect(batches).toEqual([[enorme]]);
  });

  it("estima ~4 caracteres por token", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });
});

describe("embedTexts", () => {
  it("manda input_type, modelo y dimension, y la key va en el header", async () => {
    const { impl, calls } = mockFetch([
      { status: 200, body: { data: [{ index: 0, embedding: vec() }], usage: { total_tokens: 7 } } },
    ]);

    const r = await embedTexts("pa-secretisima", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(true);
    expect(calls[0].body.input_type).toBe("document");
    expect(calls[0].body.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(calls[0].body.output_dimension).toBe(EMBEDDING_DIMENSIONS);
    expect(calls[0].auth).toBe("Bearer pa-secretisima");
    // La key nunca viaja en el cuerpo.
    expect(JSON.stringify(calls[0].body)).not.toContain("pa-secretisima");
  });

  it("respeta el orden aunque Voyage devuelva los embeddings desordenados", async () => {
    // Un embedding pegado al chunk equivocado no da error: da una busqueda que
    // miente. Por eso se reordena por index.
    const { impl } = mockFetch([
      {
        status: 200,
        body: {
          data: [
            { index: 1, embedding: vec(1) },
            { index: 0, embedding: vec(0) },
          ],
          usage: { total_tokens: 4 },
        },
      },
    ]);

    const r = await embedTexts("pa-x", ["primero", "segundo"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.embeddings[0][0]).toBe(1);
      expect(r.embeddings[1][1]).toBe(1);
    }
  });

  it("sin key no llama a la API", async () => {
    const { impl, calls } = mockFetch([{ status: 200 }]);

    const r = await embedTexts("", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe("missing_key");
    expect(calls).toHaveLength(0);
  });

  it("sin textos no llama a la API", async () => {
    const { impl, calls } = mockFetch([{ status: 200 }]);

    const r = await embedTexts("pa-x", [], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("errores", () => {
  it("401 es permanente: no reintenta", async () => {
    const { impl, calls } = mockFetch([{ status: 401, body: { error: "bad key" } }]);

    const r = await embedTexts("pa-mala", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("invalid_key");
      expect(isRetryable(r.problem)).toBe(false);
      // El mensaje es para mostrar: no filtra la key.
      expect(r.message).not.toContain("pa-mala");
    }
    expect(calls).toHaveLength(1);
  });

  it("429 reintenta y sale bien si el segundo intento anda", async () => {
    const { impl, calls } = mockFetch([
      { status: 429 },
      { status: 200, body: { data: [{ index: 0, embedding: vec() }], usage: {} } },
    ]);

    const r = await embedTexts("pa-x", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("500 reintenta hasta el tope y devuelve transitorio", async () => {
    const { impl, calls } = mockFetch([{ status: 503 }]);

    const r = await embedTexts("pa-x", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("transient");
      expect(isRetryable(r.problem)).toBe(true);
    }
    expect(calls).toHaveLength(3);
  });

  it("un error de red se reintenta", async () => {
    const { impl, calls } = mockFetch([
      { status: 0, throws: true },
      { status: 200, body: { data: [{ index: 0, embedding: vec() }], usage: {} } },
    ]);

    const r = await embedTexts("pa-x", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("400 es permanente: el pedido esta mal, reintentar da igual", async () => {
    const { impl, calls } = mockFetch([{ status: 400, body: { error: "modelo inexistente" } }]);

    const r = await embedTexts("pa-x", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe("bad_request");
    expect(calls).toHaveLength(1);
  });

  it("un embedding de otra dimension se rechaza en vez de guardarse", async () => {
    // Si esto pasara y se guardara, el insert en pgvector fallaria despues con
    // un error mucho menos claro. Mejor decir "revisa el modelo configurado".
    const { impl } = mockFetch([
      { status: 200, body: { data: [{ index: 0, embedding: [1, 2, 3] }], usage: {} } },
    ]);

    const r = await embedTexts("pa-x", ["hola"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("bad_request");
      expect(r.message).toContain("1024");
    }
  });

  it("si vuelven menos embeddings que textos, falla", async () => {
    const { impl } = mockFetch([
      { status: 200, body: { data: [{ index: 0, embedding: vec() }], usage: {} } },
    ]);

    const r = await embedTexts("pa-x", ["uno", "dos"], {
      inputType: "document",
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    expect(r.ok).toBe(false);
  });
});

describe("toPgVector", () => {
  it("arma el literal que espera pgvector", () => {
    expect(toPgVector([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });
});
