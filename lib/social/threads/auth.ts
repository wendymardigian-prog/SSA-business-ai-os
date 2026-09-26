/**
 * Conexion con Threads (F12).
 *
 * Portado de ScaleOS (`_shared/threads-api.ts`, `threads-auth/index.ts`),
 * adaptado a la interfaz comun de OAuth y con los tokens en Vault en vez de
 * una columna.
 *
 * Threads tiene un flujo en dos pasos que conviene no perder de vista: el
 * codigo se cambia por un token CORTO (una hora) y ese token hay que
 * cambiarlo por uno LARGO (60 dias) en una segunda llamada. Si se guarda el
 * corto, la conexion deja de andar al rato sin explicacion.
 *
 * El largo si se puede renovar sin volver a pedir permiso, mientras no haya
 * vencido: de eso se encarga el cron semanal.
 *
 * Endpoints: developers.facebook.com/docs/threads/get-started.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { FetchLike, OAuthAdapter, OAuthIdentity, TokenSet } from "@/lib/oauth/types";

export const THREADS_HOST = "https://graph.threads.net";
const AUTHORIZE = "https://threads.net/oauth/authorize";

export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "threads_read_replies",
  "threads_manage_replies",
];

export const THREADS_REQUIRED_SCOPES = ["threads_basic", "threads_content_publish"];

/** Cuando renovar: quedando menos de esto, el cron pide un token nuevo. */
export const THREADS_REFRESH_WHEN_DAYS_LEFT = 15;

export class ThreadsAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ThreadsAuthError";
  }
}

export function threadsAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", THREADS_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(json: Record<string, unknown>, status: number): string {
  const error = json.error as { message?: string } | undefined;
  return (
    error?.message ||
    (typeof json.error_message === "string" ? json.error_message : "") ||
    `Threads respondio ${status}`
  );
}

/** Paso 1: el codigo se cambia por un token corto (una hora). */
export async function threadsExchangeCodeForShortToken(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<{ accessToken: string; userId: string | null }> {
  const response = await (params.fetchImpl ?? fetch)(`${THREADS_HOST}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
      code: params.code,
    }).toString(),
  });

  const json = await readJson(response);
  if (!response.ok || typeof json.access_token !== "string") {
    throw new ThreadsAuthError(errorMessage(json, response.status), response.status);
  }

  return {
    accessToken: json.access_token,
    userId: typeof json.user_id === "string" ? json.user_id : String(json.user_id ?? "") || null,
  };
}

/** Paso 2: el corto se cambia por uno largo (~60 dias). */
export async function threadsExchangeLongLivedToken(params: {
  shortToken: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  const url = new URL(`${THREADS_HOST}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", params.clientSecret);
  url.searchParams.set("access_token", params.shortToken);

  const response = await (params.fetchImpl ?? fetch)(url.toString());
  const json = await readJson(response);

  if (!response.ok || typeof json.access_token !== "string") {
    throw new ThreadsAuthError(errorMessage(json, response.status), response.status);
  }

  return {
    accessToken: json.access_token,
    refreshToken: null,
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

/** Renueva un token largo. El mismo token es la credencial del pedido. */
export async function threadsRefreshLongLivedToken(params: {
  token: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  const url = new URL(`${THREADS_HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", params.token);

  const response = await (params.fetchImpl ?? fetch)(url.toString());
  const json = await readJson(response);

  if (!response.ok || typeof json.access_token !== "string") {
    throw new ThreadsAuthError(errorMessage(json, response.status), response.status);
  }

  return {
    accessToken: json.access_token,
    refreshToken: null,
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

export async function threadsFetchIdentity(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<OAuthIdentity> {
  const url = new URL(`${THREADS_HOST}/me`);
  url.searchParams.set("fields", "id,username,threads_profile_picture_url,threads_biography");
  url.searchParams.set("access_token", params.accessToken);

  const response = await (params.fetchImpl ?? fetch)(url.toString());
  const json = await readJson(response);

  if (!response.ok || typeof json.id !== "string") {
    throw new ThreadsAuthError(errorMessage(json, response.status), response.status);
  }

  const username = typeof json.username === "string" ? json.username : null;
  return {
    externalAccountId: json.id,
    label: username ? `@${username}` : "Cuenta de Threads",
    profile: {
      username,
      displayName: username,
      avatarUrl:
        typeof json.threads_profile_picture_url === "string"
          ? json.threads_profile_picture_url
          : null,
      profileUrl: username ? `https://www.threads.net/@${username}` : null,
    },
  };
}

/**
 * El adaptador: los dos pasos quedan adentro de `exchangeCode`, para que el
 * flujo comun no tenga que saber que Threads es distinto.
 */
export const threadsAdapter: OAuthAdapter = {
  provider: "threads",
  label: "Threads",
  scopes: THREADS_SCOPES,
  requiredScopes: THREADS_REQUIRED_SCOPES,
  clientIdSecretName: SECRET_NAMES.threadsAppId,
  clientSecretSecretName: SECRET_NAMES.threadsAppSecret,
  authorizeUrl: (p) => threadsAuthorizeUrl(p),
  async exchangeCode(params) {
    const short = await threadsExchangeCodeForShortToken(params);
    // Nunca se guarda el corto: dura una hora y la conexion quedaria muerta.
    return threadsExchangeLongLivedToken({
      shortToken: short.accessToken,
      clientSecret: params.clientSecret,
      fetchImpl: params.fetchImpl,
    });
  },
  fetchIdentity: threadsFetchIdentity,
  async refresh(params) {
    return threadsRefreshLongLivedToken({
      token: params.refreshToken,
      fetchImpl: params.fetchImpl,
    });
  },
};

/** Si conviene renovar ahora. Con mas de 15 dias por delante, no. */
export function threadsNeedsRefresh(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return false;
  const daysLeft = (at - now.getTime()) / (24 * 60 * 60 * 1000);
  return daysLeft < THREADS_REFRESH_WHEN_DAYS_LEFT;
}
