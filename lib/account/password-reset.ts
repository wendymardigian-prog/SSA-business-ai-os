/**
 * Las rutas de "Olvidé mi contraseña". PURO: lo leen el middleware, las
 * paginas y la plantilla del email (docs/cuenta-y-notificaciones.md).
 */

/** Donde se pide el email. */
export const RESET_REQUEST_PATH = "/recuperar";
/** Donde se pone la contraseña nueva, con la sesion de recuperacion. */
export const RESET_REDIRECT_PATH = "/restablecer";
/** El link de la plantilla en español (token_hash): funciona aunque se abra en otro navegador. */
export const AUTH_CONFIRM_PATH = "/auth/confirm";

/** Los tipos de link de Supabase Auth que acepta `/auth/confirm`. */
export const CONFIRM_TYPES = ["recovery", "email", "magiclink", "invite", "signup", "email_change"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function parseConfirmType(raw: string | null): ConfirmType | null {
  return raw && (CONFIRM_TYPES as readonly string[]).includes(raw) ? (raw as ConfirmType) : null;
}

/** Solo rutas relativas propias: nunca se redirige a un dominio externo. */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : fallback;
}
