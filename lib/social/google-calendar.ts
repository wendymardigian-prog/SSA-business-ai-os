/**
 * Conexion con Google Calendar, por persona (Etapa 4, F4).
 *
 * Mismo cliente OAuth del workspace que YouTube (Client ID y Secret en Vault)
 * y las mismas funciones de token, pero es OTRO proveedor: `google` identifica
 * la cuenta por su canal de YouTube y falla si no tiene uno, y acá lo que
 * hace falta es la cuenta de Google en si (su `sub`) y su email. Cada persona
 * puede conectar varias cuentas; la conexion se guarda a su nombre.
 *
 * Permisos, los minimos que documenta Google (developers.google.com/calendar/api/auth):
 *   - calendarlist.readonly: listar sus calendarios (calendarList.list).
 *   - events.freebusy: horarios ocupados (freeBusy.query).
 *   - events: crear, mover y borrar los eventos de las agendas (events.*).
 *   - openid email: saber de que cuenta se trata (userinfo).
 * Sin `events` la conexion queda en atencion y sirve solo para conflictos.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { FetchLike, OAuthAdapter, OAuthIdentity } from "@/lib/oauth/types";
import { GoogleAuthError, googleAuthorizeUrl, googleExchangeCode, googleRefresh } from "./google";

const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
];

/** Sin listar calendarios ni leer ocupado la conexion no sirve para nada. */
export const GOOGLE_CALENDAR_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

/** El permiso que hace falta para crear eventos (F4: sin el, solo conflictos). */
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export const MISSING_EVENTS_SCOPE_MESSAGE = "Falta el permiso para crear eventos";

export function canCreateEvents(grantedScopes: string[]): boolean {
  return grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE);
}

/** La cuenta de Google: `sub` es estable, el email es lo que se muestra. */
export async function googleCalendarFetchIdentity(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<OAuthIdentity> {
  const response = await (params.fetchImpl ?? fetch)(USERINFO, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleAuthError(`Google respondio ${response.status}`, null, response.status);
  }
  const json = (await response.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!json.sub) {
    throw new GoogleAuthError("Google no devolvio la identidad de la cuenta", "no_identity", 200);
  }
  return {
    externalAccountId: json.sub,
    label: json.email ?? json.name ?? "Cuenta de Google",
    profile: {
      username: json.email ?? null,
      displayName: json.name ?? null,
      avatarUrl: json.picture ?? null,
      profileUrl: null,
    },
  };
}

export const googleCalendarAdapter: OAuthAdapter = {
  provider: "google_calendar",
  label: "Google Calendar",
  perUser: true,
  requiredPermission: "scheduling.use",
  scopes: GOOGLE_CALENDAR_SCOPES,
  requiredScopes: GOOGLE_CALENDAR_REQUIRED_SCOPES,
  clientIdSecretName: SECRET_NAMES.googleClientId,
  clientSecretSecretName: SECRET_NAMES.googleClientSecret,
  authorizeUrl: (p) => googleAuthorizeUrl({ ...p, scopes: GOOGLE_CALENDAR_SCOPES }),
  exchangeCode: googleExchangeCode,
  fetchIdentity: googleCalendarFetchIdentity,
  refresh: googleRefresh,
};
