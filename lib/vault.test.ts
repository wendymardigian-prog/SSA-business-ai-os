import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  storeSecret,
  readSecret,
  deleteSecret,
  listSecretNames,
  isForbiddenSecretError,
} from "./vault";

const WS = "11111111-1111-1111-1111-111111111111";

/** Cliente falso: registra las llamadas a .rpc() y devuelve lo que se le diga. */
function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

afterEach(() => vi.restoreAllMocks());

describe("vault", () => {
  it("pasa el nombre limpio: el namespace por workspace lo arma la RPC, no el cliente", async () => {
    const { client, rpc } = fakeClient({});
    await storeSecret(client, WS, "zernio_api_key", "sk-abc");
    expect(rpc).toHaveBeenCalledWith("store_secret", {
      secret_name: "zernio_api_key",
      secret_value: "sk-abc",
      workspace_id: WS,
    });
  });

  it("recorta el valor y rechaza uno vacio sin ir a la base", async () => {
    const { client, rpc } = fakeClient({});
    await storeSecret(client, WS, "k", "  sk-abc  ");
    expect(rpc.mock.calls[0][1].secret_value).toBe("sk-abc");

    const empty = await storeSecret(client, WS, "k", "   ");
    expect(empty).toEqual({ ok: false, error: expect.any(String) });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("nunca deja el valor del secret en un log ni en el error devuelto", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: "forbidden: not an admin" } });

    const res = await storeSecret(client, WS, "zernio_api_key", "sk-super-secreta");

    expect(res).toEqual({ ok: false, error: "forbidden: not an admin" });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("sk-super-secreta");
    expect(JSON.stringify(res)).not.toContain("sk-super-secreta");
  });

  it("readSecret devuelve null cuando el secret no existe", async () => {
    const { client } = fakeClient({ data: null });
    await expect(readSecret(client, WS, "k")).resolves.toBeNull();
  });

  it("readSecret lanza ante un error de permisos en vez de devolver null", async () => {
    // Un null silencioso aca se lee como "no configurado" y manda a reconfigurar
    // una key que en realidad ya estaba guardada.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: "forbidden" } });
    await expect(readSecret(client, WS, "k")).rejects.toThrow(/forbidden/);
  });

  it("deleteSecret distingue borrado real de inexistente, y ninguno es error", async () => {
    const borrado = fakeClient({ data: true });
    await expect(deleteSecret(borrado.client, WS, "k")).resolves.toEqual({ ok: true, deleted: true });

    const noExistia = fakeClient({ data: false });
    await expect(deleteSecret(noExistia.client, WS, "k")).resolves.toEqual({ ok: true, deleted: false });
  });

  it("listSecretNames devuelve lista vacia ante un error, no rompe la pantalla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: "boom" } });
    await expect(listSecretNames(client, WS)).resolves.toEqual([]);
  });

  it("reconoce los dos mensajes con que la base niega el acceso", () => {
    expect(isForbiddenSecretError("forbidden: only workspace owners and admins")).toBe(true);
    expect(isForbiddenSecretError("permission denied for function read_secret")).toBe(true);
    expect(isForbiddenSecretError("connection reset")).toBe(false);
  });
});
