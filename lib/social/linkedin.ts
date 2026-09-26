/**
 * Conexion con LinkedIn (F11).
 *
 * Publica en el perfil de una persona: texto, imagenes, video y PDF. Con esta
 * conexion LinkedIn NO da metricas ni comentarios, y eso no es una limitacion
 * del sistema sino de su API gratuita; la pantalla lo dice donde corresponde.
 *
 * Dos cosas que hacen doler despues si no se tienen en cuenta:
 *   - El token dura 60 dias y **no se puede renovar** sin volver a pedir
 *     permiso: hay que avisar antes de que venza.
 *   - Toda llamada a la API de posts lleva el header `LinkedIn-Version`, y
 *     LinkedIn da de baja versiones. Por eso es una constante, en un solo
 *     lugar, con su fecha de vencimiento escrita al lado.
 *
 * Endpoints: learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 * y /linkedin/marketing/community-management/shares/posts-api.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { FetchLike, OAuthAdapter, OAuthIdentity, TokenSet } from "@/lib/oauth/types";

const AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO = "https://api.linkedin.com/v2/userinfo";

/**
 * La version de la API que se manda en cada llamada.
 *
 * LinkedIn retira versiones: la 202510 deja de funcionar el 15 de octubre de
 * 2026. Cuando llegue esa fecha hay que subirla aca y probar publicar.
 */
export const LINKEDIN_API_VERSION = "202510";

/** `openid profile email` identifican; `w_member_social` publica. */
export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];
export const LINKEDIN_REQUIRED_SCOPES = ["w_member_social"];

/** Cuanto dura el token de LinkedIn cuando no lo dice: 60 dias. */
export const LINKEDIN_DEFAULT_TTL_SECONDS = 60 * 24 * 60 * 60;

export function linkedinAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  return url.toString();
}

export class LinkedInAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

export async function linkedinExchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  const response = await (params.fetchImpl ?? fetch)(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }).toString(),
  });

  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new LinkedInAuthError(
      json.error_description || json.error || `LinkedIn respondio ${response.status}`,
      response.status,
    );
  }

  return {
    accessToken: json.access_token,
    // LinkedIn no da refresh token en el plan gratuito: cuando vence, se
    // vuelve a conectar a mano. Por eso el aviso previo importa tanto.
    refreshToken: null,
    expiresInSeconds: json.expires_in ?? LINKEDIN_DEFAULT_TTL_SECONDS,
    grantedScopes: json.scope ? json.scope.split(/[\s,]+/).filter(Boolean) : null,
  };
}

/** Quien es la persona conectada. El autor de un post es su URN. */
export async function linkedinFetchIdentity(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<OAuthIdentity> {
  const response = await (params.fetchImpl ?? fetch)(USERINFO, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!response.ok) {
    throw new LinkedInAuthError(`LinkedIn respondio ${response.status}`, response.status);
  }

  const json = (await response.json().catch(() => ({}))) as {
    sub?: string;
    name?: string;
    given_name?: string;
    picture?: string;
  };

  if (!json.sub) {
    throw new LinkedInAuthError("LinkedIn no devolvio el id de la cuenta", 502);
  }

  const name = json.name || json.given_name || "Perfil de LinkedIn";
  return {
    // El URN es lo que va como autor al publicar, asi que se guarda armado.
    externalAccountId: `urn:li:person:${json.sub}`,
    label: name,
    profile: { displayName: name, avatarUrl: json.picture ?? null },
  };
}

export const linkedinAdapter: OAuthAdapter = {
  provider: "linkedin",
  label: "LinkedIn",
  scopes: LINKEDIN_SCOPES,
  requiredScopes: LINKEDIN_REQUIRED_SCOPES,
  clientIdSecretName: SECRET_NAMES.linkedinClientId,
  clientSecretSecretName: SECRET_NAMES.linkedinClientSecret,
  authorizeUrl: (p) => linkedinAuthorizeUrl(p),
  exchangeCode: linkedinExchangeCode,
  fetchIdentity: linkedinFetchIdentity,
  // Sin refresh: LinkedIn no lo ofrece en este plan.
};

/** Los headers de toda llamada a la API de posts. */
export function linkedinHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}
