/**
 * Nombres de parametros de URL que parecen credenciales o sesiones: NUNCA se
 * reenvian ni se guardan (plano formularios-ui, F17).
 *
 * Es la lista que el embed ya usaba para no pasarle al formulario un `?token=`
 * de la pagina que lo contiene, llevada a un modulo compartido para que el
 * embed y la URL de entrada (`entry-url.ts`) cuenten con UNA sola copia. Sin
 * dependencias: tambien la importa el script del embed.
 */
export const SENSITIVE_PARAM_NAMES: ReadonlySet<string> = new Set([
  "token", "password", "pass", "passwd", "secret", "key", "code", "auth", "session", "sessionid",
  "access_token", "id_token", "refresh_token", "api_key", "apikey",
]);

/** Si el nombre (sin distinguir mayusculas) parece una credencial o una sesion. */
export function isSensitiveParamName(name: string): boolean {
  return SENSITIVE_PARAM_NAMES.has(name.toLowerCase());
}
