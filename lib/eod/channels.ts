/**
 * Los canales de un EOD de setters (E3): el catálogo fijo, los personalizados y
 * las operaciones del editor. Puro.
 *
 * No dependen de que el canal esté conectado en la app: un setter puede trabajar
 * LinkedIn a mano aunque LinkedIn no tenga bandeja.
 */
import { platformLabel } from "@/lib/platforms";
import { newFieldId, type FormField } from "@/lib/forms/fields";
import type { EodChannel } from "./types";

/**
 * Las etiquetas salen de `platformLabel` donde existe, para que se llamen igual en
 * todo el sistema. Facebook dice "Facebook / Messenger" porque lo que se trabaja ahí
 * son los mensajes; y las llamadas no son una red.
 */
export const EOD_CHANNEL_CATALOG: ReadonlyArray<{ key: string; label: string }> = [
  { key: "instagram", label: platformLabel("instagram") },
  { key: "whatsapp", label: platformLabel("whatsapp") },
  { key: "linkedin", label: platformLabel("linkedin") },
  { key: "facebook", label: "Facebook / Messenger" },
  { key: "tiktok", label: platformLabel("tiktok") },
  { key: "twitter", label: platformLabel("twitter") },
  { key: "email", label: platformLabel("email") },
  { key: "telegram", label: platformLabel("telegram") },
  { key: "phone", label: "Llamadas telefónicas" },
];

export const CUSTOM_CHANNEL_PREFIX = "custom_";
export const CHANNEL_KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;
export const MAX_CHANNELS = 30;
export const MAX_CHANNEL_LABEL = 60;

export function isCatalogChannel(key: string): boolean {
  return EOD_CHANNEL_CATALOG.some((c) => c.key === key);
}

/** "Comunidad de Skool" → "comunidad_de_skool" (sin tildes ni símbolos, hasta 40). */
export function channelSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
}

/** La clave de un canal personalizado nuevo, sin chocar con las que ya hay. */
export function customChannelKey(label: string, existing: string[]): string {
  const base = `${CUSTOM_CHANNEL_PREFIX}${channelSlug(label) || "canal"}`;
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** Todos los canales del catálogo, apagados y sin preguntas: el punto de partida. */
export function catalogChannels(): EodChannel[] {
  return EOD_CHANNEL_CATALOG.map((c) => ({ key: c.key, label: c.label, custom: false, enabled: false, fields: [] }));
}

export type ChannelOpResult = { ok: true; channels: EodChannel[] } | { ok: false; error: string };

export function addCustomChannel(channels: EodChannel[], label: string): ChannelOpResult {
  const clean = label.trim();
  if (!clean) return { ok: false, error: "Escribí el nombre del canal" };
  if (clean.length > MAX_CHANNEL_LABEL) return { ok: false, error: `Como máximo ${MAX_CHANNEL_LABEL} caracteres` };
  if (channels.length >= MAX_CHANNELS) return { ok: false, error: `Como máximo ${MAX_CHANNELS} canales` };
  if (channels.some((c) => c.label.trim().toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: "Ya hay un canal con ese nombre" };
  }
  const key = customChannelKey(clean, channels.map((c) => c.key));
  return { ok: true, channels: [...channels, { key, label: clean, custom: true, enabled: true, fields: [] }] };
}

/**
 * Prende o apaga un canal. NO toca sus preguntas: apagado, se ocultan; prendido de
 * nuevo, siguen ahí.
 */
export function toggleChannel(channels: EodChannel[], key: string, enabled: boolean): EodChannel[] {
  return channels.map((c) => (c.key === key ? { ...c, enabled } : c));
}

/** Copia de preguntas con ids internos nuevos: misma clave, misma `metricKey`, mismo todo. */
function cloneFields(fields: FormField[]): FormField[] {
  return fields.map((f) => ({ ...structuredClone(f), id: newFieldId() }));
}

/** "Copiar preguntas de…": reemplaza las preguntas de `toKey` por una copia de las de `fromKey`. */
export function copyFieldsFrom(channels: EodChannel[], fromKey: string, toKey: string): EodChannel[] {
  const source = channels.find((c) => c.key === fromKey);
  if (!source || fromKey === toKey) return channels;
  return channels.map((c) => (c.key === toKey ? { ...c, fields: cloneFields(source.fields) } : c));
}

/** "Usar estas preguntas en todos los canales activos". */
export function applyToAllActive(channels: EodChannel[], fromKey: string): EodChannel[] {
  const source = channels.find((c) => c.key === fromKey);
  if (!source) return channels;
  return channels.map((c) => (c.enabled && c.key !== fromKey ? { ...c, fields: cloneFields(source.fields) } : c));
}

export function updateChannelFields(channels: EodChannel[], key: string, fields: FormField[]): EodChannel[] {
  return channels.map((c) => (c.key === key ? { ...c, fields } : c));
}

export function activeChannels(channels: EodChannel[] | undefined): EodChannel[] {
  return (channels ?? []).filter((c) => c.enabled);
}
