/**
 * A donde vuelve la persona despues de conectar un canal por OAuth.
 *
 * Los canales se conectan desde dos lados: la pagina /dashboard/channels y la
 * pestaña Cuentas de Zernio (Integraciones). Zernio hace el OAuth y redirige a
 * `/dashboard/channels/callback`, que sincroniza y vuelve. Para volver al lugar
 * de donde se salio, el destino viaja en el `sessionStorage` del navegador y no
 * en la URL: la URL de retorno la completa Zernio con su propio query
 * (`?connected=...`), y mezclarle otro parametro depende de como lo arme ella.
 *
 * Puro, y estricto con el destino: solo una ruta interna de /dashboard, nunca
 * un link a otro sitio (un destino fabricado seria una redireccion abierta).
 */

export const CHANNELS_RETURN_KEY = "channels.returnTo";
export const DEFAULT_CHANNELS_RETURN = "/dashboard/channels";

const MAX_LENGTH = 300;

/** El destino si es una ruta interna segura; si no, null. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  // Solo rutas del panel. `//host` y `/\host` son links a otro sitio.
  if (!value.startsWith("/dashboard/") && value !== "/dashboard") return null;
  if (value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}

/** El destino a recordar antes de salir a conectar; sin uno valido, la pagina de canales de siempre. */
export function returnTargetOrDefault(value: unknown): string {
  return safeReturnTo(value) ?? DEFAULT_CHANNELS_RETURN;
}
