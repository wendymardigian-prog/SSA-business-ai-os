import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZernioApiKey, getZernioKeyState } from "./zernio-key";

const WS = "11111111-1111-1111-1111-111111111111";

/**
 * Desde la 00090 la key vive SOLO en Vault: la columna
 * `workspaces.late_api_key_encrypted` se borro. `from` sigue espiado para
 * probar que ya no se consulta ninguna tabla.
 */
function fakeClient(opts: { vaultValue?: string | null; vaultError?: string }) {
  const rpc = vi.fn().mockResolvedValue(
    opts.vaultError
      ? { data: null, error: { message: opts.vaultError } }
      : { data: opts.vaultValue ?? null, error: null },
  );

  const from = vi.fn(() => {
    throw new Error("no deberia consultar ninguna tabla: la key esta en Vault");
  });

  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

afterEach(() => vi.restoreAllMocks());

describe("getZernioApiKey", () => {
  it("usa la key de Vault", async () => {
    const { client, rpc } = fakeClient({ vaultValue: "sk-de-vault" });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBe("sk-de-vault");
    expect(rpc).toHaveBeenCalledWith("read_secret", {
      secret_name: "zernio_api_key",
      workspace_id: WS,
    });
  });

  it("no consulta ninguna tabla: el campo viejo ya no existe", async () => {
    // CAMBIO DOCUMENTADO (00090). Antes caia a
    // `workspaces.late_api_key_encrypted` cuando Vault estaba vacio. Esa
    // columna se borro despues de mover la key, asi que consultarla ahora
    // seria un error de columna inexistente.
    const { client, from } = fakeClient({ vaultValue: "sk-de-vault" });

    await getZernioApiKey(WS, { supabase: client });

    expect(from).not.toHaveBeenCalled();
  });

  it("sin key en Vault, devuelve null", async () => {
    const { client } = fakeClient({ vaultValue: null });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBeNull();
  });

  it("una key de puros espacios cuenta como no tener key", async () => {
    const { client } = fakeClient({ vaultValue: "   " });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBeNull();
  });

  it("un error leyendo Vault devuelve null, no rompe", async () => {
    // Quien llama muestra "conectala en Integraciones", que es lo unico que
    // se puede hacer. Inventar una key no ayuda a nadie.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ vaultError: "forbidden" });

    await expect(getZernioApiKey(WS, { supabase: client })).resolves.toBeNull();
  });
});


describe("getZernioKeyState: no es lo mismo no tener key que no poder mirar", () => {
  it("con key, 'present'", async () => {
    const { client } = fakeClient({ vaultValue: "sk-de-vault" });

    await expect(getZernioKeyState(WS, { supabase: client })).resolves.toEqual({
      state: "present",
      key: "sk-de-vault",
    });
  });

  it("sin key, 'absent': Zernio esta desconectado", async () => {
    const { client } = fakeClient({ vaultValue: null });

    await expect(getZernioKeyState(WS, { supabase: client })).resolves.toEqual({ state: "absent" });
  });

  it("una key de puros espacios tambien es 'absent'", async () => {
    const { client } = fakeClient({ vaultValue: "   " });

    await expect(getZernioKeyState(WS, { supabase: client })).resolves.toEqual({ state: "absent" });
  });

  it("si Vault falla, 'unknown': NO se confunde con desconectado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient({ vaultError: "permission denied" });

    await expect(getZernioKeyState(WS, { supabase: client })).resolves.toEqual({ state: "unknown" });
  });

  it("getZernioApiKey sigue devolviendo null en 'absent' y en 'unknown'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(getZernioApiKey(WS, { supabase: fakeClient({ vaultValue: null }).client })).resolves.toBeNull();
    await expect(getZernioApiKey(WS, { supabase: fakeClient({ vaultError: "x" }).client })).resolves.toBeNull();
  });
});
