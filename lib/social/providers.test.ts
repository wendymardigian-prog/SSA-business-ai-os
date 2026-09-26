/**
 * Los tres adaptadores de OAuth, con el proveedor simulado (F10, F11, F12).
 *
 * Nada llama a Google, LinkedIn ni Threads: cada test le da a `fetchImpl` la
 * respuesta que quiere probar. Lo que se verifica es lo que se rompe en
 * silencio si esta mal: los parametros que deciden si Google devuelve un
 * refresh token, que de Threads se guarde el token largo y no el corto, y que
 * los permisos guardados sean los otorgados y no los pedidos.
 */

import { describe, it, expect, vi } from "vitest";
import {
  canUploadToYouTube,
  googleAuthorizeUrl,
  googleExchangeCode,
  googleFetchIdentity,
  googleRefresh,
  isRevoked,
  GoogleAuthError,
} from "./google";
import {
  LINKEDIN_API_VERSION,
  linkedinAuthorizeUrl,
  linkedinExchangeCode,
  linkedinFetchIdentity,
  linkedinHeaders,
} from "./linkedin";
import {
  threadsAdapter,
  threadsAuthorizeUrl,
  threadsNeedsRefresh,
  threadsFetchIdentity,
} from "./threads/auth";

/** Un fetch que responde lo que se le diga, y anota a donde lo llamaron. */
function fakeFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 500, body: {} };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body,
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const body = (call: { init?: RequestInit }) =>
  Object.fromEntries(new URLSearchParams(String(call.init?.body ?? "")));

describe("Google (F10)", () => {
  it("pide el permiso con lo que hace falta para tener refresh token", () => {
    // Sin access_type=offline + prompt=consent, Google manda el refresh solo
    // la primera vez: al reconectar quedaria una conexion que dura una hora.
    const url = new URL(
      googleAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "s" }),
    );

    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
  });

  it("cambia el codigo por un token y devuelve los permisos otorgados", async () => {
    const f = fakeFetch({
      body: {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3599,
        scope:
          "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
      },
    });

    const tokens = await googleExchangeCode({
      code: "c", clientId: "cid", clientSecret: "cs",
      redirectUri: "https://app.test/cb", fetchImpl: f.impl,
    });

    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt", expiresInSeconds: 3599 });
    expect(tokens.grantedScopes).toHaveLength(2);
    expect(body(f.calls[0])).toMatchObject({ grant_type: "authorization_code", code: "c" });
  });

  it("un error del proveedor se convierte en un error con su codigo", async () => {
    const f = fakeFetch({ status: 400, body: { error: "invalid_grant", error_description: "Bad Request" } });

    await expect(
      googleRefresh({ refreshToken: "rt", clientId: "cid", clientSecret: "cs", fetchImpl: f.impl }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("invalid_grant se reconoce como acceso revocado: no tiene sentido reintentar", async () => {
    const f = fakeFetch({ status: 400, body: { error: "invalid_grant" } });

    const error = await googleRefresh({
      refreshToken: "rt", clientId: "cid", clientSecret: "cs", fetchImpl: f.impl,
    }).catch((e) => e);

    expect(isRevoked(error)).toBe(true);
    expect(isRevoked(new Error("otra cosa"))).toBe(false);
  });

  it("lee el canal de YouTube de la cuenta", async () => {
    const f = fakeFetch({
      body: {
        items: [
          { id: "UC123", snippet: { title: "Mi canal", customUrl: "@micanal", thumbnails: { default: { url: "https://x/y.jpg" } } } },
        ],
      },
    });

    const identity = await googleFetchIdentity({ accessToken: "at", fetchImpl: f.impl });

    expect(identity).toMatchObject({ externalAccountId: "UC123", label: "Mi canal" });
    expect(identity.profile?.profileUrl).toContain("UC123");
    expect(f.calls[0].url).toContain("mine=true");
  });

  it("una cuenta de Google sin canal lo dice ahora y no al publicar", async () => {
    const f = fakeFetch({ body: { items: [] } });

    await expect(googleFetchIdentity({ accessToken: "at", fetchImpl: f.impl })).rejects.toThrow(
      /no tiene un canal/i,
    );
  });

  it("sin el permiso de subir, se sabe antes de intentar publicar", () => {
    expect(canUploadToYouTube(["https://www.googleapis.com/auth/youtube.readonly"]).ok).toBe(false);
    expect(
      canUploadToYouTube([
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.upload",
      ]).ok,
    ).toBe(true);
  });
});

describe("LinkedIn (F11)", () => {
  it("pide permiso para publicar", () => {
    const url = new URL(
      linkedinAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "s" }),
    );

    expect(url.searchParams.get("scope")).toContain("w_member_social");
    expect(url.searchParams.get("state")).toBe("s");
  });

  it("el token vence en 60 dias y no hay refresh", async () => {
    // Importa: cuando vence hay que volver a conectar a mano, asi que el aviso
    // previo es lo unico que evita que las publicaciones fallen calladas.
    const f = fakeFetch({ body: { access_token: "at", expires_in: 5_184_000, scope: "w_member_social" } });

    const tokens = await linkedinExchangeCode({
      code: "c", clientId: "cid", clientSecret: "cs",
      redirectUri: "https://app.test/cb", fetchImpl: f.impl,
    });

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.expiresInSeconds).toBe(5_184_000);
  });

  it("si no dice cuanto dura, se asume 60 dias", async () => {
    const f = fakeFetch({ body: { access_token: "at" } });

    const tokens = await linkedinExchangeCode({
      code: "c", clientId: "cid", clientSecret: "cs",
      redirectUri: "https://app.test/cb", fetchImpl: f.impl,
    });

    expect(tokens.expiresInSeconds).toBe(60 * 24 * 60 * 60);
  });

  it("guarda el URN de la persona, que es lo que firma cada post", async () => {
    const f = fakeFetch({ body: { sub: "abc123", name: "Wendy M", picture: "https://x/y.jpg" } });

    const identity = await linkedinFetchIdentity({ accessToken: "at", fetchImpl: f.impl });

    expect(identity.externalAccountId).toBe("urn:li:person:abc123");
    expect(identity.label).toBe("Wendy M");
  });

  it("toda llamada lleva la version de la API", () => {
    // LinkedIn da de baja versiones: si esto se olvida, un dia deja de andar.
    expect(linkedinHeaders("at")["LinkedIn-Version"]).toBe(LINKEDIN_API_VERSION);
    expect(LINKEDIN_API_VERSION).toMatch(/^\d{6}$/);
  });
});

describe("Threads (F12)", () => {
  it("pide los permisos de publicar y leer respuestas", () => {
    const url = new URL(
      threadsAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "s" }),
    );

    expect(url.searchParams.get("scope")).toContain("threads_content_publish");
    expect(url.searchParams.get("scope")).toContain("threads_manage_replies");
  });

  it("guarda el token LARGO, no el corto: son dos llamadas", async () => {
    // El corto dura una hora. Guardarlo deja una conexion que muere sola al
    // rato y sin explicacion.
    const f = fakeFetch(
      { body: { access_token: "corto", user_id: "1" } },
      { body: { access_token: "largo", expires_in: 5_184_000 } },
    );

    const tokens = await threadsAdapter.exchangeCode({
      code: "c", clientId: "cid", clientSecret: "cs",
      redirectUri: "https://app.test/cb", fetchImpl: f.impl,
    });

    expect(tokens.accessToken).toBe("largo");
    expect(tokens.expiresInSeconds).toBe(5_184_000);
    expect(f.calls[1].url).toContain("th_exchange_token");
  });

  it("renovar usa el propio token como credencial", async () => {
    const f = fakeFetch({ body: { access_token: "renovado", expires_in: 5_184_000 } });

    const tokens = await threadsAdapter.refresh!({
      refreshToken: "largo-actual", clientId: "cid", clientSecret: "cs", fetchImpl: f.impl,
    });

    expect(tokens.accessToken).toBe("renovado");
    expect(f.calls[0].url).toContain("th_refresh_token");
  });

  it("lee el perfil con arroba", async () => {
    const f = fakeFetch({
      body: { id: "9", username: "minegocio", threads_profile_picture_url: "https://x/y.jpg" },
    });

    const identity = await threadsFetchIdentity({ accessToken: "at", fetchImpl: f.impl });

    expect(identity).toMatchObject({ externalAccountId: "9", label: "@minegocio" });
    expect(identity.profile?.profileUrl).toBe("https://www.threads.net/@minegocio");
  });

  it("se renueva cuando quedan menos de 15 dias, no antes", async () => {
    const hoy = new Date("2026-09-26T12:00:00Z");
    const enDias = (d: number) => new Date(hoy.getTime() + d * 86_400_000).toISOString();

    expect(threadsNeedsRefresh(enDias(30), hoy)).toBe(false);
    expect(threadsNeedsRefresh(enDias(14), hoy)).toBe(true);
    expect(threadsNeedsRefresh(enDias(-1), hoy)).toBe(true);
    expect(threadsNeedsRefresh(null, hoy)).toBe(false);
  });

  it("un error del proveedor sube con su mensaje", async () => {
    const f = fakeFetch({ status: 400, body: { error: { message: "Invalid client secret" } } });

    await expect(
      threadsAdapter.exchangeCode({
        code: "c", clientId: "cid", clientSecret: "malo",
        redirectUri: "https://app.test/cb", fetchImpl: f.impl,
      }),
    ).rejects.toThrow(/Invalid client secret/);
  });
});
