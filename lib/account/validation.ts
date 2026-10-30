/**
 * Las reglas de Mi cuenta → Perfil, puras y probadas. Las usan las Server
 * Actions (`lib/actions/account.ts`) y la pantalla, asi la pantalla nunca
 * acepta algo que el servidor despues rechaza.
 */

import { sniffMime } from "@/lib/content/media";
import { normalizePhone } from "@/lib/phone";

export const NAME_MAX = 80;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // el tope de bcrypt, que es lo que usa Supabase Auth
/** La pantalla recorta la foto a un cuadrado chico antes de mandarla: esto es solo el limite de seguridad. */
export const AVATAR_MAX_BYTES = 700 * 1024;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** El nombre que se muestra: sin espacios de mas, entre 1 y 80 caracteres. */
export function parseDisplayName(raw: unknown): Parsed<string> {
  if (typeof raw !== "string") return { ok: false, error: "Escribí tu nombre" };
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, error: "Escribí tu nombre" };
  if (value.length > NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${NAME_MAX} caracteres` };
  return { ok: true, value };
}

export interface ContactValues {
  phone: string | null;
  whatsapp_phone: string | null;
  whatsapp_same_as_phone: boolean;
}

/**
 * Telefono y WhatsApp. Vacio = sin dato (se puede borrar). Lo que se escribe
 * tiene que ser un numero internacional, con codigo de pais.
 */
export function parseContactInput(input: {
  phone?: unknown;
  whatsappPhone?: unknown;
  sameAsPhone?: unknown;
}): Parsed<ContactValues> {
  const same = input.sameAsPhone !== false;

  const phone = parseOptionalPhone(input.phone, "teléfono");
  if (!phone.ok) return phone;

  if (same) {
    return { ok: true, value: { phone: phone.value, whatsapp_phone: null, whatsapp_same_as_phone: true } };
  }

  const whatsapp = parseOptionalPhone(input.whatsappPhone, "WhatsApp");
  if (!whatsapp.ok) return whatsapp;
  return { ok: true, value: { phone: phone.value, whatsapp_phone: whatsapp.value, whatsapp_same_as_phone: false } };
}

function parseOptionalPhone(raw: unknown, label: string): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `El ${label} no es válido` };
  if (!raw.trim()) return { ok: true, value: null };
  const normalized = normalizePhone(raw);
  if (!normalized) {
    return { ok: false, error: `Revisá el ${label}: tiene que llevar el código de país (por ejemplo +54 9 11 2233 4455)` };
  }
  return { ok: true, value: normalized };
}

/** El WhatsApp al que se le mandan los avisos a la persona, o null si no cargó ninguno. */
export function effectiveWhatsApp(profile: Partial<ContactValues> | null | undefined): string | null {
  if (!profile) return null;
  return profile.whatsapp_same_as_phone === false ? (profile.whatsapp_phone ?? null) : (profile.phone ?? null);
}

/** Cambiar la contraseña: la actual, y la nueva dos veces. */
export function parsePasswordChange(input: {
  current?: unknown;
  next?: unknown;
  confirm?: unknown;
}): Parsed<{ current: string; next: string }> {
  const current = typeof input.current === "string" ? input.current : "";
  if (!current) return { ok: false, error: "Escribí tu contraseña actual" };
  const next = parseNewPassword(input.next, input.confirm);
  if (!next.ok) return next;
  if (next.value === current) return { ok: false, error: "La nueva contraseña tiene que ser distinta de la actual" };
  return { ok: true, value: { current, next: next.value } };
}

/** Una contraseña nueva (tambien la usa "Olvidé mi contraseña"). */
export function parseNewPassword(rawNext: unknown, rawConfirm: unknown): Parsed<string> {
  const next = typeof rawNext === "string" ? rawNext : "";
  const confirm = typeof rawConfirm === "string" ? rawConfirm : "";
  if (next.length < PASSWORD_MIN) return { ok: false, error: `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres` };
  if (next.length > PASSWORD_MAX) return { ok: false, error: `La contraseña puede tener hasta ${PASSWORD_MAX} caracteres` };
  if (!next.trim()) return { ok: false, error: "La contraseña no puede ser solo espacios" };
  if (next !== confirm) return { ok: false, error: "Las dos contraseñas no coinciden" };
  return { ok: true, value: next };
}

const DATA_URL = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/;
const AVATAR_MIMES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export type AvatarUpload =
  | { ok: true; bytes: Uint8Array; ext: "png" | "jpg" | "webp"; mime: keyof typeof AVATAR_MIMES }
  | { ok: false; error: string };

/** La foto que manda la pantalla (data URL): se valida por sus BYTES, nunca por lo que dice ser. */
export function parseAvatarDataUrl(dataUrl: unknown): AvatarUpload {
  if (typeof dataUrl !== "string") return { ok: false, error: "No llegó ninguna imagen" };
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return { ok: false, error: "La foto tiene que ser una imagen PNG, JPG o WEBP" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(match[1], "base64"));
  } catch {
    return { ok: false, error: "La imagen no se pudo leer" };
  }
  if (bytes.byteLength === 0) return { ok: false, error: "La imagen está vacía" };
  if (bytes.byteLength > AVATAR_MAX_BYTES) return { ok: false, error: "La foto pesa demasiado: probá con otra" };
  const mime = sniffMime(bytes);
  if (mime && mime in AVATAR_MIMES) {
    const m = mime as keyof typeof AVATAR_MIMES;
    return { ok: true, bytes, ext: AVATAR_MIMES[m], mime: m };
  }
  return { ok: false, error: "La foto tiene que ser una imagen PNG, JPG o WEBP" };
}
