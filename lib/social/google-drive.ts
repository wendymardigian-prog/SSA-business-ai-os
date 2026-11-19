/**
 * Conexion con Google Drive, del negocio (00374).
 *
 * Mismo cliente OAuth del workspace que YouTube y Calendar (Client ID y Secret
 * en Vault) y las mismas funciones de token. Es otro proveedor porque es otra
 * cuenta y otra vida: una sola cuenta de Drive por negocio, que conecta quien
 * administra las integraciones, y sirve para traer archivos a Recursos.
 *
 * Permiso: solo `drive.file`. Con el no se ve el Drive entero: el sistema
 * accede unicamente a los archivos que la persona ELIGE en el selector de
 * Google (Google Picker). Es el permiso que Google recomienda y no necesita su
 * auditoria de seguridad, a diferencia de `drive.readonly`.
 * developers.google.com/drive/api/guides/api-specific-auth
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { OAuthAdapter } from "@/lib/oauth/types";
import { googleAuthorizeUrl, googleExchangeCode, googleRefresh } from "./google";
import { googleCalendarFetchIdentity } from "./google-calendar";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const GOOGLE_DRIVE_SCOPES = [DRIVE_FILE_SCOPE, "openid", "email"];

/**
 * Lo unico que puede traer una conexion de Drive. Google devuelve `email` como
 * `userinfo.email` (y a veces suma `profile`).
 */
const DRIVE_ALLOWED_SCOPES = new Set([
  DRIVE_FILE_SCOPE,
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

/**
 * El token de Drive viaja al navegador (el selector de Google lo exige). Solo
 * se entrega si la conexion tiene `drive.file` y NADA mas: una conexion hecha
 * con `include_granted_scopes` arrastraba YouTube y Calendar de la misma
 * cuenta, y con ese token alguien con permiso de Recursos podia tocar el canal.
 * Sin la lista (null o vacia) no se sabe que trae: no se entrega.
 */
export function driveScopesAreNarrow(granted: readonly string[] | null | undefined): boolean {
  if (!granted || granted.length === 0) return false;
  return granted.includes(DRIVE_FILE_SCOPE) && granted.every((scope) => DRIVE_ALLOWED_SCOPES.has(scope));
}

export const googleDriveAdapter: OAuthAdapter = {
  provider: "google_drive",
  label: "Google Drive",
  scopes: GOOGLE_DRIVE_SCOPES,
  requiredScopes: [DRIVE_FILE_SCOPE],
  clientIdSecretName: SECRET_NAMES.googleClientId,
  clientSecretSecretName: SECRET_NAMES.googleClientSecret,
  authorizeUrl: (p) => googleAuthorizeUrl({ ...p, scopes: GOOGLE_DRIVE_SCOPES, selectAccount: true, includeGrantedScopes: false }),
  exchangeCode: googleExchangeCode,
  // La cuenta de Google en si (su `sub` y su email), igual que Calendar.
  fetchIdentity: googleCalendarFetchIdentity,
  refresh: googleRefresh,
};
