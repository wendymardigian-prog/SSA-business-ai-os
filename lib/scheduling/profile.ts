/**
 * El perfil de agenda (F3): el "usuario" que va en los links, la sugerencia
 * a partir del nombre y la confirmacion cuando cambiarlo rompe links.
 */

import { slugify } from "./slug";

export const RESERVED_USERNAMES = ["agenda", "embed", "api", "equipo", "admin"] as const;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 40;
const USERNAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export type UsernameError = "too_short" | "too_long" | "invalid_chars" | "reserved" | "taken";

export const USERNAME_ERROR_TEXT: Record<UsernameError, string> = {
  too_short: `Tiene que tener al menos ${USERNAME_MIN} caracteres`,
  too_long: `Tiene que tener como maximo ${USERNAME_MAX} caracteres`,
  invalid_chars: "Solo minusculas, numeros y guiones, sin empezar ni terminar con guion",
  reserved: "Ese usuario esta reservado. Elegi otro",
  taken: "Ese usuario ya lo usa otra persona del negocio",
};

/**
 * Valida el usuario. `taken` es la lista de usuarios ya usados por OTRAS
 * personas (se compara sin mayusculas).
 */
export function validateUsername(
  raw: string,
  options: { taken?: string[] } = {},
): { ok: true; username: string } | { ok: false; error: UsernameError; message: string } {
  const username = (raw ?? "").trim().toLowerCase();
  const fail = (error: UsernameError) => ({ ok: false as const, error, message: USERNAME_ERROR_TEXT[error] });
  if (username.length < USERNAME_MIN) return fail("too_short");
  if (username.length > USERNAME_MAX) return fail("too_long");
  if (!USERNAME_RE.test(username)) return fail("invalid_chars");
  if ((RESERVED_USERNAMES as readonly string[]).includes(username)) return fail("reserved");
  if ((options.taken ?? []).some((t) => t.toLowerCase() === username)) return fail("taken");
  return { ok: true, username };
}

/** Un usuario a partir del nombre: "Wendy Mardigian" -> "wendy-mardigian"; si esta tomado, "-2", "-3"... */
export function suggestUsername(displayName: string | null | undefined, email: string | null | undefined, taken: string[] = []): string {
  const fromName = slugify(displayName ?? "");
  const fromEmail = slugify((email ?? "").split("@")[0] ?? "");
  let base = fromName || fromEmail || "usuario";
  if (base.length < USERNAME_MIN) base = `${base}-agenda`;
  base = base.slice(0, USERNAME_MAX).replace(/-+$/, "");
  if ((RESERVED_USERNAMES as readonly string[]).includes(base)) base = `${base}-1`;
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, USERNAME_MAX - String(i).length - 1)}-${i}`;
    if (!lower.has(candidate)) return candidate;
  }
  return `${base.slice(0, USERNAME_MAX - 5)}-${Date.now() % 10000}`;
}

/**
 * Cambiar el usuario cambia los links de todos los eventos activos. Con
 * eventos activos se exige `confirmBrokenLinks: true`; sin ella, se rechaza
 * diciendo cuantos links cambian.
 */
export function usernameChangeNeedsConfirmation(input: {
  currentUsername: string;
  nextUsername: string;
  activeEvents: number;
  confirmBrokenLinks?: boolean;
}): { ok: true } | { ok: false; needsConfirmation: true; message: string; links: number } {
  if (input.currentUsername.toLowerCase() === input.nextUsername.toLowerCase()) return { ok: true };
  if (input.activeEvents === 0 || input.confirmBrokenLinks) return { ok: true };
  const links = input.activeEvents;
  return {
    ok: false,
    needsConfirmation: true,
    links,
    message:
      links === 1
        ? "Cambiar tu usuario cambia el link de 1 evento activo. Los links que ya compartiste van a dejar de funcionar."
        : `Cambiar tu usuario cambia los links de ${links} eventos activos. Los links que ya compartiste van a dejar de funcionar.`,
  };
}

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormatOption = (typeof TIME_FORMATS)[number];
