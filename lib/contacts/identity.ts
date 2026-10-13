/**
 * La identidad de un contacto: los "datos fuertes" con los que se reconoce a una persona.
 *
 * PURO (sin base, sin red). Es la gemela en TypeScript de `private.contact_normalize_identity` y del
 * armado de bloqueos de `public.find_or_create_contact` (migracion 00200). Los mismos casos
 * (`identity.cases.json`) corren contra esta funcion en vitest y contra la base en
 * `scripts/verify-contacts-single-entry.mjs`: si se cambia una regla hay que cambiarla en las dos.
 *
 * Que es un dato fuerte: el canal (con el id del remitente), el telefono, el WhatsApp, el email (y el
 * secundario) y los usuarios de Instagram, TikTok, X, LinkedIn y Facebook. NUNCA el nombre.
 */

import { normalizePhone } from "@/lib/phone";
import { linkedinSlug, LINKEDIN_PROFILE_BASE } from "@/lib/contacts/social";

/** Lo que se le pasa a la regla central. Todas las claves son opcionales; las vacias se descartan. */
export interface ContactIdentity {
  channel_id?: string | null;
  sender_id?: string | null;
  phone?: string | null;
  whatsapp_phone?: string | null;
  email?: string | null;
  secondary_email?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  x?: string | null;
  linkedin?: string | null;
  facebook?: string | null;
}

/** La identidad ya normalizada: solo las claves que quedaron con valor. */
export type NormalizedIdentity = { [K in keyof ContactIdentity]?: string };

/**
 * El orden en que se busca. Gana el primer dato que encuentra un contacto; los demas que apuntan a OTRO
 * contacto son conflictos. (Telefono y email prueban primero el principal y despues el segundo.)
 */
export const IDENTITY_LOOKUP_ORDER = [
  "channel",
  "phone",
  "whatsapp_phone",
  "email",
  "secondary_email",
  "instagram",
  "tiktok",
  "x",
  "linkedin",
  "facebook",
] as const;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const normalizeEmail = (raw: string | null): string | null => {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" ? null : v;
};

/** Sin "@" adelante, sin espacios en las puntas y en minusculas (igual que `normalize_handle`). */
const normalizeHandle = (raw: string | null): string | null => {
  const v = (raw ?? "").trim().replace(/^@+/, "").trim().toLowerCase();
  return v === "" ? null : v;
};

/** LinkedIn: el slug de la URL, o el texto si ya parece un slug; siempre devuelve la URL canonica. */
const normalizeLinkedin = (raw: string | null): string | null => {
  if (!raw) return null;
  let slug = linkedinSlug(raw);
  if (!slug) {
    const candidate = raw.trim().toLowerCase();
    if (/^[a-z0-9_.%-]+$/.test(candidate)) slug = candidate;
  }
  return slug ? `${LINKEDIN_PROFILE_BASE}${slug}` : null;
};

export function normalizeIdentity(input: ContactIdentity | null | undefined): NormalizedIdentity {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: NormalizedIdentity = {};

  // El canal vale solo con las dos puntas: el canal y el id del remitente.
  const channel = text(raw.channel_id)?.trim() || null;
  const sender = text(raw.sender_id)?.trim() || null;
  if (channel && sender) {
    out.channel_id = channel;
    out.sender_id = sender;
  }

  const set = (key: keyof NormalizedIdentity, value: string | null) => {
    if (value) out[key] = value;
  };
  set("phone", normalizePhone(text(raw.phone)));
  set("whatsapp_phone", normalizePhone(text(raw.whatsapp_phone)));
  set("email", normalizeEmail(text(raw.email)));
  set("secondary_email", normalizeEmail(text(raw.secondary_email)));
  set("instagram", normalizeHandle(text(raw.instagram)));
  set("tiktok", normalizeHandle(text(raw.tiktok)));
  set("x", normalizeHandle(text(raw.x)));
  set("linkedin", normalizeLinkedin(text(raw.linkedin)));
  set("facebook", normalizeHandle(text(raw.facebook)));
  return out;
}

/** ¿Hay al menos un dato fuerte? Sin uno, la regla central no crea nada (salvo que se permita). */
export function hasStrongIdentity(identity: NormalizedIdentity): boolean {
  return (
    identity.channel_id !== undefined ||
    identity.phone !== undefined ||
    identity.whatsapp_phone !== undefined ||
    identity.email !== undefined ||
    identity.secondary_email !== undefined ||
    identity.instagram !== undefined ||
    identity.tiktok !== undefined ||
    identity.x !== undefined ||
    identity.linkedin !== undefined ||
    identity.facebook !== undefined
  );
}

/**
 * Las claves de bloqueo, SIEMPRE en el mismo orden (por la clave, comparacion binaria), sin repetidas.
 * El telefono y el WhatsApp comparten tipo `phone`; el email y el secundario, `email`. Dos llamadas con el
 * mismo dato comparten al menos un bloqueo; el orden fijo evita el interbloqueo.
 */
export function identityLockKeys(identity: NormalizedIdentity): string[] {
  const keys: (string | null)[] = [
    identity.channel_id && identity.sender_id ? `channel:${identity.channel_id}:${identity.sender_id}` : null,
    identity.phone ? `phone:${identity.phone}` : null,
    identity.whatsapp_phone ? `phone:${identity.whatsapp_phone}` : null,
    identity.email ? `email:${identity.email}` : null,
    identity.secondary_email ? `email:${identity.secondary_email}` : null,
    identity.instagram ? `instagram:${identity.instagram}` : null,
    identity.tiktok ? `tiktok:${identity.tiktok}` : null,
    identity.x ? `x:${identity.x}` : null,
    identity.linkedin ? `linkedin:${identity.linkedin}` : null,
    identity.facebook ? `facebook:${identity.facebook}` : null,
  ];
  return [...new Set(keys.filter((k): k is string => k !== null))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Las columnas de `contacts` que salen de la identidad (nunca de los defaults de un alta). */
export const IDENTITY_COLUMNS = {
  phone: "phone",
  whatsapp_phone: "whatsapp_phone",
  email: "email",
  secondary_email: "secondary_email",
  instagram: "instagram_username",
  tiktok: "tiktok_username",
  x: "twitter_username",
  linkedin: "linkedin_profile_url",
  facebook: "facebook_id",
} as const;

/** Para qué dato coincidió un contacto: el `by` que devuelve la base. */
export type MatchedBy = "channel" | "phone" | "email" | "instagram" | "tiktok" | "x" | "linkedin" | "facebook";
