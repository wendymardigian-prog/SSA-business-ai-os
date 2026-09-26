/**
 * El flujo de OAuth, uno solo para los tres proveedores (F9).
 *
 * Ida (`startOAuth`): exige Owner/Admin, lee el Client ID del workspace,
 * arma un `state` firmado con su nonce y devuelve a donde mandar a la persona
 * mas la cookie que hay que poner.
 *
 * Vuelta (`completeOAuth`): valida el `state` contra la firma, el vencimiento,
 * el usuario y la cookie; cambia el codigo por un token; pregunta de quien es
 * la cuenta; guarda los tokens EN VAULT y la conexion en la base.
 *
 * Los tokens nunca tocan la tabla ni la respuesta: en `oauth_connections`
 * queda el prefijo con el que se arman sus nombres en Vault.
 *
 * Todo lo que habla con afuera entra por parametro (`fetchImpl`, el adaptador,
 * el cliente de Supabase), asi el flujo se prueba entero sin llamar a nadie.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OAuthProvider } from "@/lib/types/database";
import { readSecret, storeSecret, SECRET_NAMES, oauthSecretName } from "@/lib/vault";
import {
  newNonce,
  safeRedirect,
  signState,
  STATE_TTL_MS,
  verifyState,
  type StateFailure,
} from "./state";
import type { FetchLike, OAuthAdapter } from "./types";

type Db = SupabaseClient<Database>;

/** El prefijo con el que se guardan los tokens de una conexion en Vault. */
export function vaultPrefixFor(provider: OAuthProvider, userId: string | null): string {
  return userId ? `oauth_${provider}_${userId}` : `oauth_${provider}`;
}

/**
 * La clave con la que se firma el `state` de este workspace.
 *
 * Se genera la primera vez y queda en Vault. Es por workspace a proposito: un
 * `state` de un negocio no tiene por que validar en otro.
 */
export async function getOrCreateStateSecret(supabase: Db, workspaceId: string): Promise<string> {
  try {
    const existing = await readSecret(supabase, workspaceId, SECRET_NAMES.oauthStateSecret);
    if (existing) return existing;
  } catch {
    // No estar es el caso normal la primera vez.
  }

  const secret = randomBytes(32).toString("base64url");
  const stored = await storeSecret(supabase, workspaceId, SECRET_NAMES.oauthStateSecret, secret);
  if (!stored.ok) {
    throw new Error(`No pude guardar la clave de firma del OAuth: ${stored.error}`);
  }
  return secret;
}

export interface StartInput {
  supabase: Db;
  adapter: OAuthAdapter;
  workspaceId: string;
  userId: string;
  redirectTo?: string | null;
  /** La direccion de retorno registrada en el proveedor. */
  callbackUrl: string;
  now?: number;
}

export type StartResult =
  | { ok: true; authorizeUrl: string; nonce: string }
  | { ok: false; error: string };

/**
 * Empieza la conexion.
 *
 * Falta el Client ID = no se empieza. Mandar a alguien al proveedor sin
 * cliente configurado termina en una pantalla de error del proveedor, que no
 * explica nada.
 */
export async function startOAuth(input: StartInput): Promise<StartResult> {
  const { supabase, adapter, workspaceId, userId } = input;

  let clientId: string | null = null;
  try {
    clientId = await readSecret(supabase, workspaceId, adapter.clientIdSecretName);
  } catch {
    clientId = null;
  }

  if (!clientId) {
    return {
      ok: false,
      error: `Falta el Client ID de ${adapter.label}. Cargalo en Integraciones antes de conectar.`,
    };
  }

  const secret = await getOrCreateStateSecret(supabase, workspaceId);
  const nonce = newNonce();
  const now = input.now ?? Date.now();

  const state = signState(secret, {
    nonce,
    provider: adapter.provider,
    userId,
    workspaceId,
    redirectTo: safeRedirect(input.redirectTo),
    exp: now + STATE_TTL_MS,
  });

  return {
    ok: true,
    nonce,
    authorizeUrl: adapter.authorizeUrl({
      clientId,
      redirectUri: input.callbackUrl,
      state,
    }),
  };
}

export interface CompleteInput {
  supabase: Db;
  adapter: OAuthAdapter;
  /** El workspace y el usuario de la sesion que atiende el retorno. */
  workspaceId: string;
  userId: string;
  code?: string | null;
  state?: string | null;
  /** Lo que el proveedor informa si la persona cancelo. */
  providerError?: string | null;
  cookieNonce?: string | null;
  callbackUrl: string;
  fetchImpl?: FetchLike;
  now?: number;
}

export type CompleteResult =
  | { ok: true; redirectTo: string; connectionId: string; identity: { label: string } }
  | { ok: false; error: OAuthErrorCode; redirectTo: string };

export type OAuthErrorCode =
  | "invalid_state"
  | "cancelled"
  | "missing_code"
  | "missing_client"
  | "exchange_failed"
  | "identity_failed"
  | "save_failed";

const DEFAULT_REDIRECT = "/dashboard/settings/integrations";

export async function completeOAuth(input: CompleteInput): Promise<CompleteResult> {
  const { supabase, adapter, workspaceId, userId } = input;

  // Cancelar no es un error del sistema: se vuelve y se dice que no se conecto.
  if (input.providerError) {
    return { ok: false, error: "cancelled", redirectTo: DEFAULT_REDIRECT };
  }

  let secret: string;
  try {
    secret = await getOrCreateStateSecret(supabase, workspaceId);
  } catch {
    return { ok: false, error: "invalid_state", redirectTo: DEFAULT_REDIRECT };
  }

  const checked = verifyState(secret, input.state, {
    expectedProvider: adapter.provider,
    expectedUserId: userId,
    expectedWorkspaceId: workspaceId,
    expectedNonce: input.cookieNonce ?? null,
    now: input.now,
  });

  if (!checked.ok) {
    // El motivo se loguea (sirve para diagnosticar) pero no se le muestra a
    // nadie: decir "la firma no cierra" contra "vencio" le sirve mas a quien
    // esta probando ataques que a quien conecta su cuenta.
    logStateFailure(adapter.provider, checked.reason);
    return { ok: false, error: "invalid_state", redirectTo: DEFAULT_REDIRECT };
  }

  const redirectTo = safeRedirect(checked.payload.redirectTo);

  if (!input.code) {
    return { ok: false, error: "missing_code", redirectTo };
  }

  let clientId: string | null = null;
  let clientSecret: string | null = null;
  try {
    [clientId, clientSecret] = await Promise.all([
      readSecret(supabase, workspaceId, adapter.clientIdSecretName),
      readSecret(supabase, workspaceId, adapter.clientSecretSecretName),
    ]);
  } catch {
    return { ok: false, error: "missing_client", redirectTo };
  }
  if (!clientId || !clientSecret) {
    return { ok: false, error: "missing_client", redirectTo };
  }

  let tokens;
  try {
    tokens = await adapter.exchangeCode({
      code: input.code,
      clientId,
      clientSecret,
      redirectUri: input.callbackUrl,
      fetchImpl: input.fetchImpl,
    });
  } catch (err) {
    console.error(`[oauth] ${adapter.provider}: fallo el intercambio del codigo`, describe(err));
    return { ok: false, error: "exchange_failed", redirectTo };
  }

  let identity;
  try {
    identity = await adapter.fetchIdentity({
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
    });
  } catch (err) {
    console.error(`[oauth] ${adapter.provider}: no pude leer la cuenta`, describe(err));
    return { ok: false, error: "identity_failed", redirectTo };
  }

  const saved = await saveConnection({
    supabase,
    adapter,
    workspaceId,
    tokens,
    identity,
    now: input.now,
  });

  if (!saved.ok) return { ok: false, error: "save_failed", redirectTo };

  return {
    ok: true,
    redirectTo,
    connectionId: saved.connectionId,
    identity: { label: identity.label },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logStateFailure(provider: string, reason: StateFailure) {
  console.warn(`[oauth] ${provider}: state rechazado (${reason})`);
}

/** Guarda los tokens en Vault y la conexion en la base. En ese orden. */
export async function saveConnection(params: {
  supabase: Db;
  adapter: OAuthAdapter;
  workspaceId: string;
  tokens: Awaited<ReturnType<OAuthAdapter["exchangeCode"]>>;
  identity: Awaited<ReturnType<OAuthAdapter["fetchIdentity"]>>;
  userId?: string | null;
  now?: number;
}): Promise<{ ok: true; connectionId: string } | { ok: false }> {
  const { supabase, adapter, workspaceId, tokens, identity } = params;
  const now = params.now ?? Date.now();
  const ownerId = params.userId ?? null;
  const prefix = vaultPrefixFor(adapter.provider, ownerId);

  const stored = await storeSecret(
    supabase,
    workspaceId,
    oauthSecretName(prefix, "access_token"),
    tokens.accessToken,
  );
  if (!stored.ok) {
    console.error(`[oauth] ${adapter.provider}: no pude guardar el token`, stored.error);
    return { ok: false };
  }

  if (tokens.refreshToken) {
    const refresh = await storeSecret(
      supabase,
      workspaceId,
      oauthSecretName(prefix, "refresh_token"),
      tokens.refreshToken,
    );
    if (!refresh.ok) {
      console.error(`[oauth] ${adapter.provider}: no pude guardar el refresh`, refresh.error);
      return { ok: false };
    }
  }

  const granted = tokens.grantedScopes ?? adapter.scopes;
  const missing = adapter.requiredScopes.filter((scope) => !granted.includes(scope));

  const row = {
    workspace_id: workspaceId,
    provider: adapter.provider,
    user_id: ownerId,
    external_account_id: identity.externalAccountId,
    account_label: identity.label,
    granted_scopes: granted,
    token_expires_at: tokens.expiresInSeconds
      ? new Date(now + tokens.expiresInSeconds * 1000).toISOString()
      : null,
    refresh_expires_at: tokens.refreshExpiresInSeconds
      ? new Date(now + tokens.refreshExpiresInSeconds * 1000).toISOString()
      : null,
    // Falta un permiso imprescindible: se guarda igual (reconectar pidiendolo
    // de nuevo es mas facil que empezar de cero) pero la card lo dice.
    status: missing.length > 0 ? ("attention" as const) : ("active" as const),
    last_error:
      missing.length > 0 ? `Faltan permisos: ${missing.join(", ")}` : null,
    last_refreshed_at: new Date(now).toISOString(),
    vault_secret_prefix: prefix,
  };

  // Reconectar actualiza la fila que ya existe: el unico es (workspace,
  // proveedor, persona), asi que dos conexiones del mismo proveedor no pueden
  // convivir ni por accidente.
  const { data, error } = await supabase
    .from("oauth_connections")
    .upsert(row, { onConflict: "workspace_id,provider,user_id" })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error(`[oauth] ${adapter.provider}: no pude guardar la conexion`, error?.message);
    return { ok: false };
  }

  return { ok: true, connectionId: data.id };
}

/** Mensajes para la pantalla, en palabras y sin detalles que no ayudan. */
export const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  invalid_state: "El pedido de conexion no era valido o tardo demasiado. Proba de nuevo.",
  cancelled: "No se conecto: cancelaste el permiso.",
  missing_code: "El proveedor no devolvio el codigo de autorizacion. Proba de nuevo.",
  missing_client: "Faltan el Client ID o el Client Secret. Cargalos en Integraciones.",
  exchange_failed: "El proveedor rechazo la conexion. Revisa que el cliente OAuth sea el correcto.",
  identity_failed: "Se conecto, pero no pude leer la cuenta. Proba de nuevo.",
  save_failed: "No pude guardar la conexion. Proba de nuevo.",
};
