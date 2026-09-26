/**
 * Conexion con Google, para YouTube (F10).
 *
 * El negocio crea su propio cliente OAuth en Google Cloud y pega Client ID y
 * Secret; el sistema no tiene una app compartida. Es lo que corresponde: los
 * videos se suben a la cuenta del negocio y la cuota diaria es suya.
 *
 * Tres parametros del pedido de permiso no son decorativos:
 *   - `access_type=offline` y `prompt=consent`: sin los dos, Google devuelve
 *     un refresh token la primera vez y nunca mas. Al reconectar quedaria una
 *     conexion que funciona una hora y despues no.
 *   - `include_granted_scopes=true`: conserva los permisos ya otorgados en vez
 *     de reemplazarlos.
 *
 * Endpoints: developers.google.com/identity/protocols/oauth2/web-server y
 * developers.google.com/youtube/v3/docs/channels/list.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { FetchLike, OAuthAdapter, OAuthIdentity, TokenSet } from "@/lib/oauth/types";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

/** Lo que hace falta para subir videos y leer metricas y comentarios. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  // Leer y responder comentarios.
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

/**
 * Sin leer el canal no se puede ni saber a donde se conecto. Publicar es lo
 * que la gente espera, pero si falta se avisa y el resto sigue andando: la
 * conexion igual sirve para metricas.
 */
export const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
];

/** Se le pide a Google que devuelva SIEMPRE un refresh token. */
export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (params.scopes ?? GOOGLE_SCOPES).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** `invalid_grant` = el permiso se revoco o el refresh ya no sirve. */
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Lo que devuelve Google al pedir o renovar un token. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  fetchImpl: FetchLike,
  body: Record<string, string>,
): Promise<TokenSet> {
  const response = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const json = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || !json.access_token) {
    throw new GoogleAuthError(
      json.error_description || json.error || `Google respondio ${response.status}`,
      json.error ?? null,
      response.status,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSeconds: json.expires_in ?? null,
    // Google informa lo que otorgo de verdad: puede ser menos de lo pedido.
    grantedScopes: json.scope ? json.scope.split(" ").filter(Boolean) : null,
  };
}

export async function googleExchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  return tokenRequest(params.fetchImpl ?? fetch, {
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
}

/**
 * Renueva el access token.
 *
 * Google no devuelve un refresh nuevo: se conserva el que ya se tenia. Si
 * responde `invalid_grant`, el permiso se revoco y no tiene sentido
 * reintentar: hay que volver a conectar.
 */
export async function googleRefresh(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  return tokenRequest(params.fetchImpl ?? fetch, {
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });
}

/** `true` cuando el acceso se revoco y reintentar no sirve. */
export function isRevoked(error: unknown): boolean {
  return error instanceof GoogleAuthError && error.code === "invalid_grant";
}

/** El canal de YouTube de la cuenta conectada. */
export async function googleFetchIdentity(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<OAuthIdentity> {
  const url = new URL(CHANNELS);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");

  const response = await (params.fetchImpl ?? fetch)(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!response.ok) {
    throw new GoogleAuthError(`YouTube respondio ${response.status}`, null, response.status);
  }

  const json = (await response.json().catch(() => ({}))) as {
    items?: Array<{
      id?: string;
      snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
    }>;
  };

  const channel = json.items?.[0];
  if (!channel?.id) {
    // Una cuenta de Google sin canal de YouTube: conectarla no sirve de nada y
    // conviene decirlo ahora y no al intentar publicar.
    throw new GoogleAuthError(
      "Esta cuenta de Google no tiene un canal de YouTube",
      "no_channel",
      200,
    );
  }

  const title = channel.snippet?.title ?? "Canal de YouTube";
  return {
    externalAccountId: channel.id,
    label: title,
    profile: {
      username: channel.snippet?.customUrl ?? null,
      displayName: title,
      avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
      profileUrl: `https://www.youtube.com/channel/${channel.id}`,
    },
  };
}

export const googleAdapter: OAuthAdapter = {
  provider: "google",
  label: "Google (YouTube)",
  scopes: GOOGLE_SCOPES,
  requiredScopes: GOOGLE_REQUIRED_SCOPES,
  clientIdSecretName: SECRET_NAMES.googleClientId,
  clientSecretSecretName: SECRET_NAMES.googleClientSecret,
  authorizeUrl: (p) => googleAuthorizeUrl(p),
  exchangeCode: googleExchangeCode,
  fetchIdentity: googleFetchIdentity,
  refresh: googleRefresh,
};

/** Si se puede publicar con esta conexion, o por que no. */
export function canUploadToYouTube(grantedScopes: string[]): { ok: boolean; reason?: string } {
  const upload = "https://www.googleapis.com/auth/youtube.upload";
  if (!grantedScopes.includes(upload)) {
    return {
      ok: false,
      reason: "La conexion con Google no incluye permiso para subir videos. Reconectala y aceptalo.",
    };
  }
  return { ok: true };
}
