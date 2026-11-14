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

export const googleDriveAdapter: OAuthAdapter = {
  provider: "google_drive",
  label: "Google Drive",
  scopes: GOOGLE_DRIVE_SCOPES,
  requiredScopes: [DRIVE_FILE_SCOPE],
  clientIdSecretName: SECRET_NAMES.googleClientId,
  clientSecretSecretName: SECRET_NAMES.googleClientSecret,
  authorizeUrl: (p) => googleAuthorizeUrl({ ...p, scopes: GOOGLE_DRIVE_SCOPES, selectAccount: true }),
  exchangeCode: googleExchangeCode,
  // La cuenta de Google en si (su `sub` y su email), igual que Calendar.
  fetchIdentity: googleCalendarFetchIdentity,
  refresh: googleRefresh,
};
