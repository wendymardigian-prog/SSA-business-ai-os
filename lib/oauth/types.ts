/**
 * El contrato que cumple cada proveedor de OAuth.
 *
 * El flujo (lib/oauth/flow.ts) es uno solo: pedir permiso, volver con un
 * codigo, cambiarlo por un token, preguntar de quien es la cuenta y guardar.
 * Lo que cambia entre Google, LinkedIn y Threads son las direcciones, los
 * nombres de los parametros y donde vive la identidad. Eso es este adaptador.
 *
 * `fetchImpl` esta en cada firma para poder simular al proveedor en los tests:
 * en la corrida de construccion no se llama a ninguno de verdad.
 */

import type { OAuthProvider } from "@/lib/types/database";

export type FetchLike = typeof fetch;

/** Lo que devuelve el proveedor al cambiar el codigo por un token. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  /** Segundos hasta que vence el access token. */
  expiresInSeconds?: number | null;
  /** Segundos hasta que vence el refresh token, cuando el proveedor lo dice. */
  refreshExpiresInSeconds?: number | null;
  /** Los permisos que otorgo DE VERDAD, si los informa. */
  grantedScopes?: string[] | null;
}

/** De quien es la cuenta que se acaba de conectar. */
export interface OAuthIdentity {
  /** El id de la cuenta en el proveedor. */
  externalAccountId: string;
  /** Como se muestra ("@minegocio", "Canal de Wendy"). */
  label: string;
  /** Datos de perfil, cuando el proveedor los da en el mismo paso. */
  profile?: {
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    profileUrl?: string | null;
  };
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export interface ExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}

export interface OAuthAdapter {
  provider: OAuthProvider;
  label: string;
  /** Los permisos que se piden. */
  scopes: string[];
  /**
   * Sin estos la integracion no sirve para nada. Los que no estan aca son
   * opcionales: si faltan, la conexion queda en "requiere atencion" y se dice
   * cual falta, pero sigue funcionando para lo demas.
   */
  requiredScopes: string[];
  /** Nombres de los secretos del cliente OAuth en Vault. */
  clientIdSecretName: string;
  clientSecretSecretName: string;
  authorizeUrl(params: AuthorizeParams): string;
  exchangeCode(params: ExchangeParams): Promise<TokenSet>;
  fetchIdentity(params: { accessToken: string; fetchImpl?: FetchLike }): Promise<OAuthIdentity>;
  /** Solo si el proveedor permite renovar sin volver a pedir permiso. */
  refresh?(params: RefreshParams): Promise<TokenSet>;
}
