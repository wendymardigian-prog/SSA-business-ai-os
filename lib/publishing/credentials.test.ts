/**
 * De donde sale la clave de cada publicador, y cuando hay que renovarla (A2).
 *
 * El caso que importa es Google: su access token dura UNA HORA y el unico
 * refresco era un cron semanal. O sea que casi siempre estaba vencido cuando
 * llegaba el momento de subir un video.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { PublishError } from "@/lib/jobs/errors";
import { needsFreshToken, FRESH_TOKEN_MARGIN_MINUTES } from "@/lib/social/refresh-connection";

const WS = "ws-1";
const NOW = new Date("2026-09-26T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const googleRefresh = vi.fn();

vi.mock("@/lib/oauth/registry", () => ({
  getOAuthAdapter: (provider: string) =>
    provider === "google"
      ? {
          provider: "google",
          label: "Google",
          clientIdSecretName: "google_client_id",
          clientSecretSecretName: "google_client_secret",
          refresh: googleRefresh,
        }
      : null,
}));

const { credentialsForPublisher } = await import("./credentials");

/** Vault en memoria: la RPC guarda y lee del mismo mapa. */
function dbWith(secrets: Record<string, string>, expiresAt: string | null): MemoryDb {
  const vault = { ...secrets };
  return memoryDb(
    {
      oauth_connections: [
        {
          id: "conn-1",
          workspace_id: WS,
          provider: "google",
          status: "active",
          vault_secret_prefix: "oauth_google_ws1",
          token_expires_at: expiresAt,
          user_id: null,
        },
      ],
    },
    {
      rpc: {
        read_secret: (args) => vault[String(args.secret_name)] ?? null,
        store_secret: (args) => {
          vault[String(args.secret_name)] = String(args.secret_value);
          return true;
        },
      },
    },
  );
}

const SECRETS = {
  "oauth_google_ws1_access_token": "viejo",
  "oauth_google_ws1_refresh_token": "refresh-1",
  google_client_id: "cid",
  google_client_secret: "csecret",
};

beforeEach(() => {
  googleRefresh.mockReset();
  vi.setSystemTime(NOW);
});

describe("needsFreshToken", () => {
  it("sin fecha de vencimiento, no renueva", () => {
    expect(needsFreshToken(null, NOW)).toBe(false);
  });

  it("con horas por delante, no renueva", () => {
    expect(needsFreshToken(inMinutes(120), NOW)).toBe(false);
  });

  it("dentro del margen, renueva", () => {
    expect(needsFreshToken(inMinutes(FRESH_TOKEN_MARGIN_MINUTES - 1), NOW)).toBe(true);
  });

  it("ya vencido, renueva", () => {
    expect(needsFreshToken(inMinutes(-60), NOW)).toBe(true);
  });
});

describe("A2 · el token de Google se renueva en el momento", () => {
  it("renueva y devuelve el token nuevo cuando esta por vencer", async () => {
    googleRefresh.mockResolvedValue({ accessToken: "nuevo", expiresInSeconds: 3600 });
    const db = dbWith(SECRETS, inMinutes(2));

    const creds = await credentialsForPublisher(db.client, {
      publisherId: "youtube_api",
      workspaceId: WS,
    });

    expect(googleRefresh).toHaveBeenCalledOnce();
    expect(creds.token).toBe("nuevo");
    // Y queda guardado, para que la proxima no tenga que renovar de nuevo.
    expect(db.rows("oauth_connections")[0].token_expires_at).toBe(inMinutes(60));
  });

  it("no gasta una llamada si al token le sobra tiempo", async () => {
    const db = dbWith(SECRETS, inMinutes(120));

    const creds = await credentialsForPublisher(db.client, {
      publisherId: "youtube_api",
      workspaceId: WS,
    });

    expect(googleRefresh).not.toHaveBeenCalled();
    expect(creds.token).toBe("viejo");
  });

  it("si el refresco falla, lo dice en vez de publicar con un token muerto", async () => {
    googleRefresh.mockRejectedValue(new Error("invalid_grant"));
    const db = dbWith(SECRETS, inMinutes(-10));

    await expect(
      credentialsForPublisher(db.client, { publisherId: "youtube_api", workspaceId: WS }),
    ).rejects.toBeInstanceOf(PublishError);
  });
});
