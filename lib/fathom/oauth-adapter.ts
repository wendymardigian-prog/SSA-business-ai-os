/**
 * Fathom como proveedor del OAuth generico (F5).
 *
 * Cada closer conecta SU cuenta de Fathom con la app OAuth del negocio (Client
 * ID y Secret en Vault, cargados en Integraciones). Es una conexion por
 * persona (`perUser`) y no pide permiso: cualquier miembro puede conectar la
 * suya (`anyMember`, decision 153). Que sus llamadas entren o no lo decide la
 * marca "es closer" de Equipo, no la conexion.
 *
 * Portado de prevxcrm (`fathom-oauth.ts`): sin el `state` propio (se usa el
 * firmado de `lib/oauth/state.ts`) y sin `fetch` directo (todo recibe
 * `fetchImpl`, asi la corrida de construccion no llama a Fathom de verdad).
 *
 * OJO: los refresh token de Fathom son de UN SOLO USO. Cada renovacion devuelve
 * uno nuevo que REEMPLAZA al anterior (`lib/fathom/auth.ts` lo guarda siempre).
 *
 * Nada de lo que falle aca loguea el codigo, el secreto ni un token.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type {
  AuthorizeParams,
  ExchangeParams,
  FetchLike,
  OAuthAdapter,
  OAuthIdentity,
  RefreshParams,
  TokenSet,
} from "@/lib/oauth/types";
import { FATHOM_API_BASE, FATHOM_AUTHORIZE_URL, FATHOM_SCOPE, FATHOM_TOKEN_URL } from "./api-constants";

export class FathomAuthError extends Error {
  constructor(
    message: string,
    /** `invalid_grant` = el permiso se revoco o el refresh ya no sirve. */
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "FathomAuthError";
  }

  /** El acceso se perdio para siempre: hay que reconectar. */
  get isPermanent(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403;
  }
}

interface FathomTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

function toTokenSet(json: FathomTokenResponse): TokenSet {
  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token ?? null,
    expiresInSeconds: Number(json.expires_in) || 3600,
    refreshExpiresInSeconds: null,
    grantedScopes: json.scope ? json.scope.split(/\s+/).filter(Boolean) : [FATHOM_SCOPE],
  };
}

async function postToken(body: Record<string, string>, fetchImpl: FetchLike, what: string): Promise<TokenSet> {
  const response = await fetchImpl(FATHOM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json().catch(() => ({}))) as FathomTokenResponse;
  if (!response.ok || !json.access_token) {
    // Solo el estado y el codigo del error: nunca el cuerpo, que puede repetir el secreto o el codigo.
    const code = typeof json.error === "string" ? json.error : null;
    throw new FathomAuthError(`Fathom rechazo ${what} (${response.status}${code ? `, ${code}` : ""})`, code, response.status);
  }
  return toTokenSet(json);
}

export function fathomAuthorizeUrl(params: AuthorizeParams): string {
  const url = new URL(FATHOM_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", FATHOM_SCOPE);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export function fathomExchangeCode(params: ExchangeParams): Promise<TokenSet> {
  return postToken(
    {
      grant_type: "authorization_code",
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    },
    params.fetchImpl ?? fetch,
    "el codigo",
  );
}

export function fathomRefresh(params: RefreshParams): Promise<TokenSet> {
  return postToken(
    {
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
    params.fetchImpl ?? fetch,
    "la renovacion",
  );
}

/**
 * El id de la cuenta externa. Fathom es UNA cuenta por persona: un id fijo hace
 * que reconectar actualice la misma fila (el unico es workspace + proveedor +
 * persona + cuenta) en vez de crear otra, aunque `/users/me` falle una vez y
 * funcione la siguiente.
 */
export const FATHOM_ACCOUNT_ID = "fathom";

/**
 * De quien es la cuenta. `/users/me` no es esencial: si falla, la conexion se
 * hace igual con "Cuenta de Fathom" (prevxcrm lo trata como dato opcional).
 * Nunca lanza.
 */
export async function fathomFetchIdentity(params: { accessToken: string; fetchImpl?: FetchLike }): Promise<OAuthIdentity> {
  const fallback: OAuthIdentity = { externalAccountId: FATHOM_ACCOUNT_ID, label: "Cuenta de Fathom" };
  try {
    const response = await (params.fetchImpl ?? fetch)(`${FATHOM_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!response.ok) return fallback;
    const json = (await response.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      user?: { email?: string; name?: string };
    };
    const email = json.email ?? json.user?.email ?? null;
    const name = json.name ?? json.user?.name ?? null;
    if (!email && !name) return fallback;
    return {
      externalAccountId: FATHOM_ACCOUNT_ID,
      label: email ?? name ?? "Cuenta de Fathom",
      profile: { username: email, displayName: name, avatarUrl: null, profileUrl: null },
    };
  } catch {
    return fallback;
  }
}

export const fathomAdapter: OAuthAdapter = {
  provider: "fathom",
  label: "Fathom",
  perUser: true,
  anyMember: true,
  scopes: [FATHOM_SCOPE],
  requiredScopes: [FATHOM_SCOPE],
  clientIdSecretName: SECRET_NAMES.fathomClientId,
  clientSecretSecretName: SECRET_NAMES.fathomClientSecret,
  authorizeUrl: fathomAuthorizeUrl,
  exchangeCode: fathomExchangeCode,
  fetchIdentity: fathomFetchIdentity,
  refresh: fathomRefresh,
};
