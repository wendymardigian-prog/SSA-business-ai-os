import { describe, expect, it, vi } from "vitest";
import { FATHOM_ACCOUNT_ID, FathomAuthError, fathomAdapter, fathomAuthorizeUrl, fathomExchangeCode, fathomFetchIdentity, fathomRefresh } from "./oauth-adapter";
import { FATHOM_TOKEN_URL } from "./api-constants";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fathomAdapter", () => {
  it("es por persona, sin permiso aparte, con el scope public_api", () => {
    expect(fathomAdapter).toMatchObject({ provider: "fathom", perUser: true, anyMember: true, scopes: ["public_api"], requiredScopes: ["public_api"] });
    expect(fathomAdapter.requiredPermission).toBeUndefined();
    expect(fathomAdapter.clientIdSecretName).toBe("fathom_client_id");
    expect(fathomAdapter.clientSecretSecretName).toBe("fathom_client_secret");
  });
});

describe("authorizeUrl", () => {
  it("incluye scope=public_api y el state recibido", () => {
    const url = new URL(fathomAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.test/api/oauth/fathom/callback", state: "ESTADO" }));
    expect(url.origin + url.pathname).toBe("https://fathom.video/external/v1/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("public_api");
    expect(url.searchParams.get("state")).toBe("ESTADO");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/oauth/fathom/callback");
  });
});

describe("exchangeCode y refresh", () => {
  it("cambia el codigo por tokens con un form-urlencoded", async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: "AT", refresh_token: "RT", expires_in: 1800, scope: "public_api" }));
    const t = await fathomExchangeCode({ code: "CODE", clientId: "cid", clientSecret: "SECRETO", redirectUri: "https://x/cb", fetchImpl: fetchImpl as never });
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresInSeconds: 1800, grantedScopes: ["public_api"] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FATHOM_TOKEN_URL);
    expect((init.body as URLSearchParams).get("grant_type")).toBe("authorization_code");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("renueva con el refresh token", async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: "AT2", refresh_token: "RT2" }));
    const t = await fathomRefresh({ refreshToken: "RT1", clientId: "cid", clientSecret: "s", fetchImpl: fetchImpl as never });
    expect(t.refreshToken).toBe("RT2");
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).get("grant_type")).toBe("refresh_token");
  });

  it("un 400 de Fathom lanza FathomAuthError sin repetir el codigo ni el secreto", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "invalid_grant", detail: "CODE-SECRETO usado" }, 400));
    const err = await fathomExchangeCode({ code: "CODE-SECRETO", clientId: "cid", clientSecret: "CLIENT-SECRETO", redirectUri: "https://x", fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toBeInstanceOf(FathomAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(err.isPermanent).toBe(true);
    expect(err.message).not.toContain("CODE-SECRETO");
    expect(err.message).not.toContain("CLIENT-SECRETO");
  });

  it("un 503 no es permanente", async () => {
    const err = await fathomRefresh({ refreshToken: "x", clientId: "c", clientSecret: "s", fetchImpl: (async () => json({}, 503)) as never }).catch((e) => e);
    expect(err.isPermanent).toBe(false);
    expect(err.status).toBe(503);
  });
});

describe("fetchIdentity", () => {
  it("usa el correo de /users/me", async () => {
    const id = await fathomFetchIdentity({ accessToken: "AT", fetchImpl: (async () => json({ email: "Ana@Negocio.io", name: "Ana" })) as never });
    expect(id).toMatchObject({ externalAccountId: FATHOM_ACCOUNT_ID, label: "Ana@Negocio.io" });
  });
  it("si /users/me falla (404 o red) devuelve la identidad de respaldo y NO lanza", async () => {
    const a = await fathomFetchIdentity({ accessToken: "AT", fetchImpl: (async () => json({}, 404)) as never });
    expect(a).toEqual({ externalAccountId: "fathom", label: "Cuenta de Fathom" });
    const b = await fathomFetchIdentity({ accessToken: "AT", fetchImpl: (async () => { throw new Error("red"); }) as never });
    expect(b.label).toBe("Cuenta de Fathom");
  });
  it("el id es el mismo con y sin correo: reconectar no crea otra fila", async () => {
    const con = await fathomFetchIdentity({ accessToken: "A", fetchImpl: (async () => json({ email: "a@b.io" })) as never });
    const sin = await fathomFetchIdentity({ accessToken: "B", fetchImpl: (async () => json({}, 500)) as never });
    expect(con.externalAccountId).toBe(sin.externalAccountId);
  });
});
