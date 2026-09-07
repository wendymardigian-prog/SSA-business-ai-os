import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZernioApiKey } from "./zernio-key";

const WS = "11111111-1111-1111-1111-111111111111";

function fakeClient(opts: {
  vaultValue?: string | null;
  vaultError?: string;
  column?: string | null;
}) {
  const rpc = vi.fn().mockResolvedValue(
    opts.vaultError
      ? { data: null, error: { message: opts.vaultError } }
      : { data: opts.vaultValue ?? null, error: null },
  );

  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: opts.column === undefined ? null : { late_api_key_encrypted: opts.column },
        error: null,
      }),
  };

  const from = vi.fn(() => chain);
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

afterEach(() => vi.restoreAllMocks());

describe("getZernioApiKey", () => {
  it("usa la key de Vault cuando existe, sin tocar el campo viejo", async () => {
    const { client, from } = fakeClient({ vaultValue: "sk-de-vault", column: "sk-vieja" });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBe("sk-de-vault");
    expect(from).not.toHaveBeenCalled();
  });

  it("cae al campo viejo cuando Vault no tiene nada", async () => {
    const { client, rpc } = fakeClient({ vaultValue: null, column: "sk-vieja" });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBe("sk-vieja");
    expect(rpc).toHaveBeenCalledWith("read_secret", {
      secret_name: "zernio_api_key",
      workspace_id: WS,
    });
  });

  it("un error leyendo Vault no impide usar el campo viejo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ vaultError: "forbidden", column: "sk-vieja" });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBe("sk-vieja");
  });

  it("devuelve null cuando no hay key en ningun lado", async () => {
    const { client } = fakeClient({ vaultValue: null, column: null });
    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBeNull();
  });

  it("trata un campo viejo vacio como si no hubiera key", async () => {
    const { client } = fakeClient({ vaultValue: null, column: "   " });
    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBeNull();
  });
});
