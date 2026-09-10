import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const readSecret = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});

import {
  generateEmbeddings,
  embedQuery,
  isEmbeddingProviderConnected,
  getEmbeddingModel,
} from "./embeddings";
import { EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "./voyage";

function vec(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
}

/** Cliente falso que devuelve la fila de integration_configs que le pidas. */
function fakeClient(row: unknown | null, error?: { message: string }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: error ?? null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const VOYAGE_ROW = {
  vault_secret_name: "voyage_api_key",
  config: { embedding_model: "voyage-4-lite" },
};

beforeEach(() => {
  readSecret.mockReset();
});

describe("cuando Voyage esta conectado", () => {
  it("genera los embeddings y no devuelve la key", async () => {
    readSecret.mockResolvedValue("pa-secretisima");
    const embedImpl = vi.fn(async () => ({
      ok: true as const,
      embeddings: [vec()],
      model: "voyage-4-lite",
      totalTokens: 12,
    }));

    const r = await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient(VOYAGE_ROW),
      embedImpl,
    });

    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("pa-secretisima");
  });

  it("le pasa a Voyage la key y el modelo configurado", async () => {
    readSecret.mockResolvedValue("pa-x");
    const embedImpl = vi.fn(async () => ({
      ok: true as const,
      embeddings: [vec()],
      model: "voyage-4",
      totalTokens: 1,
    }));

    await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient({ vault_secret_name: "voyage_api_key", config: { embedding_model: "voyage-4" } }),
      embedImpl,
    });

    expect(embedImpl).toHaveBeenCalledWith("pa-x", ["hola"], expect.objectContaining({ model: "voyage-4" }));
  });

  it("embedQuery pide input_type=query, no document", async () => {
    // No es un detalle: Voyage trata distinto una consulta de un documento, y
    // usar el equivocado empeora el resultado de la busqueda sin dar error.
    readSecret.mockResolvedValue("pa-x");
    const embedImpl = vi.fn(async () => ({
      ok: true as const,
      embeddings: [vec()],
      model: "voyage-4-lite",
      totalTokens: 1,
    }));

    await embedQuery("ws-1", "cuanto sale?", { supabase: fakeClient(VOYAGE_ROW), embedImpl });

    expect(embedImpl).toHaveBeenCalledWith("pa-x", ["cuanto sale?"], expect.objectContaining({ inputType: "query" }));
  });
});

describe("cuando falta algo, nada se rompe", () => {
  it("sin Voyage conectado avisa donde conectarlo y no reintenta", async () => {
    const embedImpl = vi.fn();

    const r = await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient(null),
      embedImpl: embedImpl as never,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("not_connected");
      expect(r.retryable).toBe(false);
      expect(r.message).toContain("Integraciones");
    }
    // Ni siquiera intenta leer la key.
    expect(readSecret).not.toHaveBeenCalled();
    expect(embedImpl).not.toHaveBeenCalled();
  });

  it("si no puede leer la key, es reintentable", async () => {
    readSecret.mockRejectedValue(new Error("forbidden"));

    const r = await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient(VOYAGE_ROW),
      embedImpl: vi.fn() as never,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("read_failed");
      expect(r.retryable).toBe(true);
    }
  });

  it("una key invalida NO es reintentable: reintentar no la arregla", async () => {
    readSecret.mockResolvedValue("pa-mala");
    const embedImpl = vi.fn(async () => ({
      ok: false as const,
      problem: "invalid_key" as const,
      message: "Voyage AI rechazo la API key.",
    }));

    const r = await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient(VOYAGE_ROW),
      embedImpl,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("invalid_key");
      expect(r.retryable).toBe(false);
    }
  });

  it("un rate limit SI es reintentable", async () => {
    readSecret.mockResolvedValue("pa-x");
    const embedImpl = vi.fn(async () => ({
      ok: false as const,
      problem: "rate_limited" as const,
      message: "Voyage esta limitando el ritmo.",
    }));

    const r = await generateEmbeddings("ws-1", ["hola"], {
      inputType: "document",
      supabase: fakeClient(VOYAGE_ROW),
      embedImpl,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });
});

describe("consultas de estado", () => {
  it("isEmbeddingProviderConnected dice que si cuando hay fila activa", async () => {
    expect(await isEmbeddingProviderConnected("ws-1", fakeClient({ id: "x" }))).toBe(true);
    expect(await isEmbeddingProviderConnected("ws-1", fakeClient(null))).toBe(false);
  });

  it("getEmbeddingModel cae al default si no hay nada configurado", async () => {
    expect(await getEmbeddingModel("ws-1", fakeClient(null))).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(await getEmbeddingModel("ws-1", fakeClient({ config: { embedding_model: "  " } }))).toBe(
      DEFAULT_EMBEDDING_MODEL,
    );
    expect(await getEmbeddingModel("ws-1", fakeClient({ config: { embedding_model: "voyage-4-large" } }))).toBe(
      "voyage-4-large",
    );
  });
});
