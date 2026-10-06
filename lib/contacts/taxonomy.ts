/**
 * El vocabulario de la atribución (F81).
 *
 * Es la decisión de fondo del bloque: sin una taxonomía CERRADA los dashboards
 * no se pueden agrupar. Si un contacto entra como "instagram", otro como "IG" y
 * otro como "Instagram DM", "cuántos leads trae Instagram" no tiene respuesta.
 *
 * Cinco campos, cada uno con una pregunta distinta:
 *
 *   source   DÓNDE pasó (la plataforma o la propiedad)
 *   medium   CÓMO llegó (el mecanismo)
 *   campaign la campaña u oferta
 *   content  LA PIEZA concreta que lo trajo
 *   term     la palabra clave
 *
 * Lo que NO está en la lista no se descarta: se guarda crudo (en minúsculas) y,
 * en el caso del medio, se marca `medium_raw` para que los agrupadores sepan que
 * ese valor no es uno de los conocidos. Perder un `utm_source` raro es perder
 * justo lo que alguien se tomó el trabajo de etiquetar.
 *
 * Módulo PURO: lo importan los receptores, el servidor y la pantalla.
 */

/** DÓNDE ocurrió el toque. */
export const SOURCES = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "threads",
  "whatsapp",
  "email",
  "google",
  "web",
  "referral",
  "direct",
  "manual",
  "csv",
] as const;
export type KnownSource = (typeof SOURCES)[number];

/** CÓMO llegó. */
export const MEDIUMS = [
  "dm",
  "comment",
  "story_reply",
  "mention",
  "link_in_bio",
  "paid_social",
  "organic_social",
  "email",
  "form",
  "booking",
  "qr",
  "import",
] as const;
export type KnownMedium = (typeof MEDIUMS)[number];

/** Por qué camino técnico entró el toque (columna `origin`). */
export const ORIGINS = ["dm", "comment", "booking", "form", "manual", "import"] as const;
export type TouchOrigin = (typeof ORIGINS)[number];

/**
 * Las formas más comunes de escribir lo mismo. Solo las que no dejan duda: un
 * alias ambiguo mapeado "por si acaso" mete datos en la fuente equivocada.
 */
const SOURCE_ALIASES: Record<string, KnownSource> = {
  ig: "instagram",
  insta: "instagram",
  "instagram.com": "instagram",
  yt: "youtube",
  "youtube.com": "youtube",
  tt: "tiktok",
  "tiktok.com": "tiktok",
  wa: "whatsapp",
  "whatsapp.com": "whatsapp",
  "linkedin.com": "linkedin",
  "threads.net": "threads",
  "google.com": "google",
};

/** Los `utm_medium` que se usan en la práctica y qué medio de la lista son. */
const MEDIUM_ALIASES: Record<string, KnownMedium> = {
  paid: "paid_social",
  cpc: "paid_social",
  paidsocial: "paid_social",
  "paid-social": "paid_social",
  organic: "organic_social",
  social: "organic_social",
  "organic-social": "organic_social",
  bio: "link_in_bio",
  "link-in-bio": "link_in_bio",
  linkinbio: "link_in_bio",
  "story-reply": "story_reply",
  mail: "email",
  newsletter: "email",
  qrcode: "qr",
  "qr-code": "qr",
};

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim().toLowerCase();
  return text ? text : null;
};

/**
 * La fuente tal como se guarda: una de la lista, o el valor crudo en minúsculas.
 * Devuelve null solo si no vino nada.
 */
export function normalizeSource(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  if ((SOURCES as readonly string[]).includes(value)) return value;
  return SOURCE_ALIASES[value] ?? value;
}

/**
 * El medio tal como se guarda. `raw: true` cuando NO es uno de los conocidos: el
 * valor se conserva igual, pero los agrupadores saben que no es de la lista.
 */
export function normalizeMedium(
  raw: string | null | undefined,
): { medium: string | null; raw: boolean } {
  const value = clean(raw);
  if (!value) return { medium: null, raw: false };
  if ((MEDIUMS as readonly string[]).includes(value)) return { medium: value, raw: false };
  const alias = MEDIUM_ALIASES[value];
  if (alias) return { medium: alias, raw: false };
  return { medium: value, raw: true };
}

export function isKnownSource(value: string | null | undefined): value is KnownSource {
  return Boolean(value) && (SOURCES as readonly string[]).includes(value as string);
}

export function isKnownMedium(value: string | null | undefined): value is KnownMedium {
  return Boolean(value) && (MEDIUMS as readonly string[]).includes(value as string);
}

// ── En lenguaje claro, para la pantalla (F88) ────────────────────────────────

export const SOURCE_LABELS: Record<KnownSource, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  whatsapp: "WhatsApp",
  email: "Email",
  google: "Google",
  web: "Web",
  referral: "Referido",
  direct: "Directo",
  manual: "Alta manual",
  csv: "Importación",
};

export const MEDIUM_LABELS: Record<KnownMedium, string> = {
  dm: "mensaje directo",
  comment: "comentario",
  story_reply: "respuesta a una historia",
  mention: "mención",
  link_in_bio: "link de la bio",
  paid_social: "anuncio",
  organic_social: "contenido orgánico",
  email: "email",
  form: "formulario",
  booking: "reserva",
  qr: "código QR",
  import: "importación",
};

/**
 * Fuentes que ya no se escriben pero siguen guardadas: el agendamiento marcaba
 * sus contactos con `source: 'scheduling'` (00099). No son de la lista cerrada,
 * pero tienen nombre propio en vez de verse como una fuente cruda cualquiera.
 */
const LEGACY_SOURCE_LABELS: Record<string, string> = { scheduling: "Agendamiento" };

/** "Instagram" para una fuente de la lista; para una cruda, la misma capitalizada. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  if (isKnownSource(source)) return SOURCE_LABELS[source];
  if (LEGACY_SOURCE_LABELS[source]) return LEGACY_SOURCE_LABELS[source];
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/** "comentario" para un medio de la lista; para uno crudo, tal cual. */
export function mediumLabel(medium: string | null | undefined): string {
  if (!medium) return "";
  return isKnownMedium(medium) ? MEDIUM_LABELS[medium] : medium;
}

export const ORIGIN_LABELS: Record<TouchOrigin, string> = {
  dm: "Mensaje directo",
  comment: "Comentario",
  booking: "Reserva",
  form: "Formulario",
  manual: "Alta manual",
  import: "Importación",
};
