import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const readSecret = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});

import { getWorkspaceModel, listConnectedAiProviders } from "./provider";

/**
 * Cliente falso que devuelve las filas de integration_configs que le pidas.
 * Mismo patron que el resto de los tests del repo: nada de base real.
 */
function fakeClient(rows: unknown[] | null, error?: { message: string }) {
  const eq = vi.fn();
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (...args: unknown[]) => {
      eq(...args);
      return builder;
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: error ?? null }),
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    eq,
  };
}

const ANTHROPIC_ROW = {
  provider: "anthropic",
  vault_secret_name: "anthropic_api_key",
  config: { default_model: "claude-sonnet-5" },
};

beforeEach(() => {
  readSecret.mockReset();
});

describe("cuando todo esta bien", () => {
  it("devuelve el modelo del proveedor conectado", async () => {
    readSecret.mockResolvedValue("sk-ant-loquesea");
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
    expect(r.modelId).toBe("claude-sonnet-5");
    expect(r.model).toBeDefined();
  });

  it("nunca devuelve la key", async () => {
    readSecret.mockResolvedValue("sk-ant-secretisima");
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(JSON.stringify({ ...r, model: undefined })).not.toContain("secretisima");
  });

  it("el nodo puede pedir un modelo puntual", async () => {
    readSecret.mockResolvedValue("sk-ant-x");
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", {
      supabase: client,
      modelId: "claude-haiku-4-5-20251001",
    });

    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("si el proveedor pedido no esta conectado, usa el que si lo esta", async () => {
    readSecret.mockResolvedValue("sk-ant-x");
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", {
      supabase: client,
      preferredProvider: "openai",
    });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
  });
});

describe("cuando falta algo, el flow no se rompe", () => {
  it("avisa que no hay ningun proveedor conectado", async () => {
    const { client } = fakeClient([]);
    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(false);
    expect(r.problem).toBe("no_provider");
    expect(r.message).toContain("Integraciones");
  });

  it("avisa que falta la key, nombrando el proveedor", async () => {
    readSecret.mockResolvedValue(null);
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(false);
    expect(r.problem).toBe("no_key");
    expect(r.message).toContain("Anthropic");
  });

  it("aguanta que Vault tire error y no propaga la excepcion", async () => {
    readSecret.mockRejectedValue(new Error("permiso denegado"));
    const { client } = fakeClient([ANTHROPIC_ROW]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(false);
    expect(r.problem).toBe("read_failed");
    // El motivo tecnico no se filtra al mensaje que ve una persona.
    expect(r.message).not.toContain("permiso denegado");
  });

  it("aguanta que falle la consulta a la base", async () => {
    const { client } = fakeClient(null, { message: "boom" });
    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(false);
    expect(r.problem).toBe("read_failed");
  });

  it("rechaza un proveedor que no esta en el catalogo", async () => {
    readSecret.mockResolvedValue("k");
    const { client } = fakeClient([
      { provider: "inventado", vault_secret_name: null, config: null },
    ]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(false);
    expect(r.problem).toBe("unsupported_provider");
  });
});

describe("los tres proveedores del catalogo se pueden instanciar", () => {
  it.each([
    ["anthropic", "anthropic_api_key", "claude-sonnet-5"],
    ["openai", "openai_api_key", "gpt-5"],
    ["google_ai", "google_ai_api_key", "gemini-2.5-flash"],
  ])("%s", async (provider, secretName, expectedModel) => {
    readSecret.mockResolvedValue("una-key");
    const { client } = fakeClient([
      { provider, vault_secret_name: secretName, config: null },
    ]);

    const r = await getWorkspaceModel("ws-1", { supabase: client });

    expect(r.ok).toBe(true);
    // Sin default_model guardado, cae al que declara el catalogo.
    expect(r.modelId).toBe(expectedModel);
  });
});

describe("lista de proveedores para la UI", () => {
  it("devuelve etiqueta y modelos, sin nada sensible", async () => {
    const { client } = fakeClient([ANTHROPIC_ROW]);
    const lista = await listConnectedAiProviders("ws-1", client);

    expect(lista).toHaveLength(1);
    expect(lista[0].label).toBe("Anthropic (Claude)");
    expect(lista[0].defaultModel).toBe("claude-sonnet-5");
    expect(lista[0].models.length).toBeGreaterThan(0);
    expect(JSON.stringify(lista)).not.toContain("vault_secret_name");
  });

  it("ignora un proveedor que no esta en el catalogo", async () => {
    const { client } = fakeClient([
      { provider: "inventado", vault_secret_name: null, config: null },
    ]);
    expect(await listConnectedAiProviders("ws-1", client)).toEqual([]);
  });
});
