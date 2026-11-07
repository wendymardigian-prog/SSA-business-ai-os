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

/** Un origen que no existe: solo sirve para que `URL` resuelva la ruta relativa. */
const NEXT_BASE = "https://app.invalid";

/**
 * Solo rutas relativas propias: nunca se redirige a un dominio externo.
 *
 * Se resuelve con `URL` (como lo haria el navegador) en vez de mirar el texto:
 * `/\evil.com`, `/<TAB>/evil.com` o `/.//evil.com` empiezan con una sola "/"
 * pero el navegador los lleva a otro dominio. Se devuelve la ruta ya
 * normalizada (`pathname + search + hash`), nunca lo que vino.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, NEXT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== NEXT_BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Una ruta que, ya normalizada, empieza con "//" es un link a otro dominio.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}
