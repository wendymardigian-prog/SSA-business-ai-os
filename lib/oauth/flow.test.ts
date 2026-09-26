/**
 * El flujo de OAuth de punta a punta, con el proveedor simulado.
 *
 * No se llama a Google, LinkedIn ni Threads: el adaptador es falso y el
 * `fetch` nunca se usa. Lo que se prueba es lo que decide el sistema —a quien
 * deja empezar, que rechaza al volver, y donde termina cada dato— que es
 * justo lo que no se puede ver probando la conexion a mano una vez.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret, storeSecret } = vi.hoisted(() => ({
  readSecret: vi.fn(),
  storeSecret: vi.fn(),
}));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret, storeSecret };
});

import { completeOAuth, startOAuth, vaultPrefixFor } from "./flow";
import { signState, STATE_TTL_MS } from "./state";
import type { OAuthAdapter } from "./types";

const WS = "ws-1";
const USER = "user-1";
const NOW = 1_800_000_000_000;
const CALLBACK = "https://app.test/api/oauth/google/callback";
const STATE_SECRET = "clave-de-firma-del-workspace-123456";

const exchangeCode = vi.fn();
const fetchIdentity = vi.fn();

const adapter: OAuthAdapter = {
  provider: "google",
  label: "Google (YouTube)",
  scopes: ["youtube.readonly", "youtube.upload"],
  requiredScopes: ["youtube.readonly"],
  clientIdSecretName: "google_client_id",
  clientSecretSecretName: "google_client_secret",
  authorizeUrl: ({ clientId, redirectUri, state }) =>
    `https://proveedor.test/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
  exchangeCode,
  fetchIdentity,
};

/** Vault con estos secretos; lo que no este, no existe. */
function vault(secrets: Record<string, string>) {
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) => {
    if (name in secrets) return secrets[name];
    return null;
  });
}

const db = () => memoryDb({ oauth_connections: [] });

const okSecrets = {
  google_client_id: "client-id-de-prueba",
  google_client_secret: "client-secret-de-prueba",
  oauth_state_secret: STATE_SECRET,
};

beforeEach(() => {
  vi.clearAllMocks();
  storeSecret.mockResolvedValue({ ok: true });
  vault(okSecrets);
  exchangeCode.mockResolvedValue({
    accessToken: "token-de-acceso",
    refreshToken: "token-de-refresco",
    expiresInSeconds: 3600,
    grantedScopes: ["youtube.readonly", "youtube.upload"],
  });
  fetchIdentity.mockResolvedValue({
    externalAccountId: "canal-123",
    label: "Canal de prueba",
  });
});

describe("empezar la conexion", () => {
  it("devuelve a donde mandar a la persona, con el state firmado", async () => {
    const result = await startOAuth({
      supabase: db().client,
      adapter,
      workspaceId: WS,
      userId: USER,
      callbackUrl: CALLBACK,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authorizeUrl).toContain("client_id=client-id-de-prueba");
    expect(result.authorizeUrl).toContain(encodeURIComponent(CALLBACK));
    expect(result.nonce.length).toBeGreaterThan(10);
  });

  it("sin Client ID no se empieza, y lo dice en palabras", async () => {
    // Mandar a alguien al proveedor sin cliente configurado termina en una
    // pantalla de error del proveedor, que no explica nada.
    vault({ oauth_state_secret: STATE_SECRET });

    const result = await startOAuth({
      supabase: db().client,
      adapter,
      workspaceId: WS,
      userId: USER,
      callbackUrl: CALLBACK,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Client ID") });
  });

  it("la clave de firma se crea la primera vez y queda en Vault", async () => {
    vault({ google_client_id: "client-id-de-prueba" });

    const result = await startOAuth({
      supabase: db().client,
      adapter,
      workspaceId: WS,
      userId: USER,
      callbackUrl: CALLBACK,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(storeSecret).toHaveBeenCalledWith(
      expect.anything(),
      WS,
      "oauth_state_secret",
      expect.any(String),
    );
  });
});

/** Un state valido para el retorno. */
function validState(over: Record<string, unknown> = {}) {
  return signState(STATE_SECRET, {
    nonce: "nonce-1",
    provider: "google",
    userId: USER,
    workspaceId: WS,
    redirectTo: "/dashboard/settings/integrations",
    exp: NOW + STATE_TTL_MS,
    ...over,
  });
}

const complete = (over: Record<string, unknown> = {}, database = db()) =>
  completeOAuth({
    supabase: database.client,
    adapter,
    workspaceId: WS,
    userId: USER,
    code: "codigo-de-autorizacion",
    state: validState(),
    cookieNonce: "nonce-1",
    callbackUrl: CALLBACK,
    now: NOW,
    ...over,
  });

describe("volver del proveedor", () => {
  it("guarda los tokens en Vault y la conexion en la base", async () => {
    const database = db();
    const result = await complete({}, database);

    expect(result.ok).toBe(true);
    // Los tokens van a Vault...
    expect(storeSecret.mock.calls.map((c) => c[2])).toEqual([
      "oauth_google_access_token",
      "oauth_google_refresh_token",
    ]);
    // ...y a la tabla va todo menos los tokens.
    const row = database.rows("oauth_connections")[0];
    expect(row).toMatchObject({
      workspace_id: WS,
      provider: "google",
      external_account_id: "canal-123",
      account_label: "Canal de prueba",
      status: "active",
      vault_secret_prefix: "oauth_google",
    });
    expect(JSON.stringify(row)).not.toContain("token-de-acceso");
    expect(JSON.stringify(row)).not.toContain("token-de-refresco");
  });

  it("guarda cuando vence el token", async () => {
    const database = db();
    await complete({}, database);

    expect(database.rows("oauth_connections")[0].token_expires_at).toBe(
      new Date(NOW + 3600 * 1000).toISOString(),
    );
  });

  it("si falta un permiso imprescindible, queda en atencion y dice cual", async () => {
    exchangeCode.mockResolvedValue({
      accessToken: "token-de-acceso",
      grantedScopes: ["youtube.upload"],
    });
    const database = db();

    await complete({}, database);

    expect(database.rows("oauth_connections")[0]).toMatchObject({
      status: "attention",
      last_error: expect.stringContaining("youtube.readonly"),
    });
  });

  it("guarda los permisos que el proveedor otorgo, no los que se pidieron", async () => {
    exchangeCode.mockResolvedValue({
      accessToken: "t",
      grantedScopes: ["youtube.readonly"],
    });
    const database = db();

    await complete({}, database);

    expect(database.rows("oauth_connections")[0].granted_scopes).toEqual(["youtube.readonly"]);
  });

  it("reconectar actualiza la conexion, no crea otra", async () => {
    const database = db();
    await complete({}, database);
    fetchIdentity.mockResolvedValue({ externalAccountId: "canal-123", label: "Canal renombrado" });
    await complete({}, database);

    expect(database.rows("oauth_connections")).toHaveLength(1);
    expect(database.rows("oauth_connections")[0].account_label).toBe("Canal renombrado");
  });

  it("si la persona cancela, se vuelve sin guardar nada", async () => {
    const database = db();
    const result = await complete({ providerError: "access_denied" }, database);

    expect(result).toMatchObject({ ok: false, error: "cancelled" });
    expect(database.rows("oauth_connections")).toHaveLength(0);
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("un state con la firma rota se rechaza sin tocar nada", async () => {
    const database = db();
    const result = await complete({ state: "fabricado.por-otro" }, database);

    expect(result).toMatchObject({ ok: false, error: "invalid_state" });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(database.rows("oauth_connections")).toHaveLength(0);
  });

  it("un state vencido se rechaza", async () => {
    const result = await complete({ state: validState({ exp: NOW - 1 }) });

    expect(result).toMatchObject({ ok: false, error: "invalid_state" });
  });

  it("un state de otro usuario se rechaza", async () => {
    const result = await complete({ state: validState({ userId: "otro-usuario" }) });

    expect(result).toMatchObject({ ok: false, error: "invalid_state" });
  });

  it("un state de otro workspace se rechaza", async () => {
    const result = await complete({ state: validState({ workspaceId: "ws-2" }) });

    expect(result).toMatchObject({ ok: false, error: "invalid_state" });
  });

  it("sin la cookie del navegador se rechaza, aunque el state sea valido", async () => {
    const result = await complete({ cookieNonce: null });

    expect(result).toMatchObject({ ok: false, error: "invalid_state" });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("el mismo state dos veces: la segunda no tiene cookie y falla", async () => {
    const database = db();
    expect((await complete({}, database)).ok).toBe(true);

    const segunda = await complete({ cookieNonce: null }, database);
    expect(segunda).toMatchObject({ ok: false, error: "invalid_state" });
    expect(database.rows("oauth_connections")).toHaveLength(1);
  });

  it("sin codigo se vuelve con el motivo", async () => {
    expect(await complete({ code: null })).toMatchObject({ ok: false, error: "missing_code" });
  });

  it("si el proveedor rechaza el codigo, no queda una conexion a medias", async () => {
    exchangeCode.mockRejectedValue(new Error("invalid_grant"));
    const database = db();

    const result = await complete({}, database);

    expect(result).toMatchObject({ ok: false, error: "exchange_failed" });
    expect(database.rows("oauth_connections")).toHaveLength(0);
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("si no se puede leer la cuenta, tampoco se guarda", async () => {
    fetchIdentity.mockRejectedValue(new Error("403"));
    const database = db();

    const result = await complete({}, database);

    expect(result).toMatchObject({ ok: false, error: "identity_failed" });
    expect(database.rows("oauth_connections")).toHaveLength(0);
  });

  it("si Vault no guarda el token, la conexion no se crea", async () => {
    storeSecret.mockImplementation(async (_c: unknown, _w: string, name: string) =>
      name === "oauth_google_access_token" ? { ok: false, error: "vault caido" } : { ok: true },
    );
    const database = db();

    const result = await complete({}, database);

    expect(result).toMatchObject({ ok: false, error: "save_failed" });
    expect(database.rows("oauth_connections")).toHaveLength(0);
  });

  it("vuelve a donde se pidio, y una direccion de afuera se ignora", async () => {
    const dentro = await complete({ state: validState({ redirectTo: "/dashboard/social" }) });
    expect(dentro).toMatchObject({ ok: true, redirectTo: "/dashboard/social" });

    const fuera = await complete({
      state: validState({ redirectTo: "https://sitio-del-atacante.test" }),
    });
    expect(fuera).toMatchObject({ redirectTo: "/dashboard/settings/integrations" });
  });
});

describe("donde viven los tokens", () => {
  it("una conexion del workspace y una de una persona no comparten prefijo", () => {
    expect(vaultPrefixFor("google", null)).toBe("oauth_google");
    expect(vaultPrefixFor("google", "user-9")).toBe("oauth_google_user-9");
  });
});
