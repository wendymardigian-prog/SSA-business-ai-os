/**
 * Cómo una respuesta se vuelve un contacto (F15): el modo, qué hacer con uno que
 * ya existe y el mapeo campo por campo. PURO.
 *
 * `contacts` tiene solo `display_name` (no hay apellido ni empresa como campos
 * fijos): el nombre y el apellido se juntan en `display_name` y la empresa va a un
 * campo personalizado (D6). Sin email ni teléfono mapeados ninguna respuesta crea
 * ni vincula contacto (decisión 156).
 */
import { z } from "zod";
import { SOCIAL_LABELS, SOCIAL_LOOKUP_PLATFORMS, type SocialPlatform } from "@/lib/contacts/social";
import type { FormField, FormFieldType } from "./fields";

export type ContactMode = "create_or_link" | "link_only";
export type ContactUpdate = "fill_empty" | "overwrite";

export const FIXED_TARGETS = [
  "contact.display_name",
  "contact.first_name_part",
  "contact.last_name_part",
  "contact.email",
  "contact.phone",
  "contact.whatsapp_phone",
  "contact.country",
  "contact.instagram_username",
  "contact.tiktok_username",
  "contact.twitter_username",
  "contact.linkedin_profile_url",
  "contact.facebook_id",
  "contact.youtube_channel_id",
] as const;
export type FixedTarget = (typeof FIXED_TARGETS)[number];

export const FIXED_TARGET_LABELS: Record<FixedTarget, string> = {
  "contact.display_name": "Nombre completo",
  "contact.first_name_part": "Nombre (se junta con el apellido)",
  "contact.last_name_part": "Apellido (se junta con el nombre)",
  "contact.email": "Email",
  "contact.phone": "Teléfono",
  "contact.whatsapp_phone": "WhatsApp",
  "contact.country": "País",
  "contact.instagram_username": SOCIAL_LABELS.instagram,
  "contact.tiktok_username": SOCIAL_LABELS.tiktok,
  "contact.twitter_username": SOCIAL_LABELS.x,
  "contact.linkedin_profile_url": SOCIAL_LABELS.linkedin,
  "contact.facebook_id": SOCIAL_LABELS.facebook,
  "contact.youtube_channel_id": SOCIAL_LABELS.youtube,
};

/** El destino del contacto de cada red social (`contact.<columna>`). */
export const SOCIAL_TARGET: Record<SocialPlatform, FixedTarget> = {
  instagram: "contact.instagram_username",
  tiktok: "contact.tiktok_username",
  x: "contact.twitter_username",
  linkedin: "contact.linkedin_profile_url",
  facebook: "contact.facebook_id",
  youtube: "contact.youtube_channel_id",
};

/** Al revés: de qué red es un destino, o null si no es de una red social. */
export function socialPlatformOf(target: string): SocialPlatform | null {
  for (const platform of Object.keys(SOCIAL_TARGET) as SocialPlatform[]) {
    if (SOCIAL_TARGET[platform] === target) return platform;
  }
  return null;
}


export const CUSTOM_PREFIX = "contact.custom.";

export interface MapEntry {
  fieldKey: string;
  target: string;
}

export interface ContactConfig {
  mode: ContactMode;
  update: ContactUpdate;
  map: MapEntry[];
}

export const DEFAULT_CONTACT_CONFIG: ContactConfig = { mode: "create_or_link", update: "fill_empty", map: [] };

export interface CustomFieldDef {
  id: string;
  slug: string;
  name: string;
  type: "text" | "number" | "boolean" | "date" | "url" | "email";
}

const entrySchema = z.object({ fieldKey: z.string().min(1).max(60), target: z.string().min(1).max(120) });
const configSchema = z.object({
  mode: z.enum(["create_or_link", "link_only"]).default("create_or_link"),
  update: z.enum(["fill_empty", "overwrite"]).default("fill_empty"),
  map: z.array(entrySchema).max(100).default([]),
});

export function isCustomTarget(target: string): boolean {
  return target.startsWith(CUSTOM_PREFIX) && target.length > CUSTOM_PREFIX.length;
}

export function customSlugOf(target: string): string {
  return target.slice(CUSTOM_PREFIX.length);
}

const ISO2 = /^[A-Za-z]{2}$/;

/** ¿Un campo de este tipo se puede guardar en este destino? */
export function targetAccepts(
  field: Pick<FormField, "type" | "options" | "social">,
  target: string,
  customType?: CustomFieldDef["type"],
): boolean {
  const type: FormFieldType = field.type;

  if (isCustomTarget(target)) {
    if (!customType) return false;
    switch (type) {
      case "email":
        return customType === "email" || customType === "text";
      case "phone":
        return customType === "text";
      case "number":
      case "rating":
      case "nps":
        return customType === "number" || customType === "text";
      case "date":
        return customType === "date" || customType === "text";
      case "consent":
        return customType === "boolean";
      case "single_select":
      case "multi_select":
      case "long_text":
        return customType === "text";
      case "short_text":
      case "hidden":
        return customType === "text" || customType === "url" || customType === "email";
      default:
        return false;
    }
  }

  switch (target as FixedTarget) {
    case "contact.display_name":
    case "contact.first_name_part":
    case "contact.last_name_part":
      return type === "short_text" || type === "hidden";
    case "contact.email":
      return type === "email";
    case "contact.phone":
    case "contact.whatsapp_phone":
      return type === "phone";
    case "contact.instagram_username":
    case "contact.tiktok_username":
    case "contact.twitter_username":
    case "contact.linkedin_profile_url":
    case "contact.facebook_id":
    case "contact.youtube_channel_id": {
      const platform = socialPlatformOf(target)!;
      // Un campo `social` solo va a la columna de SU red. Un texto corto u oculto también puede ir a una
      // red (alguien armó el formulario con un texto): al enviar se normaliza y, si no es válido, no se guarda.
      if (type === "social") return field.social?.platform === platform;
      return type === "short_text" || type === "hidden";
    }
    case "contact.country":
      if (type === "single_select") return (field.options ?? []).length > 0 && (field.options ?? []).every((o) => ISO2.test(o.trim()));
      return type === "short_text";
    default:
      return false;
  }
}

export type ConfigResult = { ok: true; config: ContactConfig } | { ok: false; errors: string[] };

/**
 * Valida la configuración contra los campos y los campos personalizados que
 * existen hoy. Un mapeo incompatible no se puede guardar. Un campo personalizado
 * borrado NO es un error acá (se marca "campo inexistente" y el envío lo ignora).
 */
export function validateContactConfig(input: unknown, fields: FormField[], customFields: CustomFieldDef[]): ConfigResult {
  const parsed = configSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: ["La configuración del contacto no es válida"] };
  const config = parsed.data as ContactConfig;
  const errors: string[] = [];

  const seenFields = new Set<string>();
  const seenTargets = new Set<string>();
  for (const entry of config.map) {
    const field = fields.find((f) => f.key === entry.fieldKey);
    if (!field) {
      errors.push(`El campo "${entry.fieldKey}" ya no existe en el formulario`);
      continue;
    }
    if (seenFields.has(entry.fieldKey)) errors.push(`"${field.label}" está mapeado dos veces`);
    seenFields.add(entry.fieldKey);
    if (seenTargets.has(entry.target)) errors.push(`Dos campos van al mismo dato del contacto (${targetLabel(entry.target, customFields)})`);
    seenTargets.add(entry.target);

    if (isCustomTarget(entry.target)) {
      const def = customFields.find((c) => c.slug === customSlugOf(entry.target));
      // Un campo personalizado borrado se ignora al enviar y se marca en la pantalla: no bloquea.
      if (def && !targetAccepts(field, entry.target, def.type)) {
        errors.push(`"${field.label}" (${FORM_TYPE_NAME[field.type]}) no se puede guardar en "${def.name}" (${def.type})`);
      }
    } else if (!(FIXED_TARGETS as readonly string[]).includes(entry.target)) {
      errors.push(`Destino desconocido: ${entry.target}`);
    } else if (!targetAccepts(field, entry.target)) {
      errors.push(`"${field.label}" (${FORM_TYPE_NAME[field.type]}) no se puede guardar en "${targetLabel(entry.target, customFields)}"`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}

const FORM_TYPE_NAME: Record<FormFieldType, string> = {
  short_text: "texto corto",
  long_text: "texto largo",
  email: "email",
  phone: "teléfono",
  number: "número",
  single_select: "selección única",
  multi_select: "selección múltiple",
  date: "fecha",
  rating: "estrellas",
  nps: "NPS",
  file: "archivo",
  consent: "consentimiento",
  hidden: "oculto",
  social: "usuario de red social",
};

export function targetLabel(target: string, customFields: CustomFieldDef[]): string {
  if (isCustomTarget(target)) {
    const def = customFields.find((c) => c.slug === customSlugOf(target));
    return def ? `Campo personalizado: ${def.name}` : "Campo personalizado (ya no existe)";
  }
  return FIXED_TARGET_LABELS[target as FixedTarget] ?? target;
}

/** Destinos que se ofrecen para un campo, ya filtrados por compatibilidad. */
export function targetsFor(field: FormField, customFields: CustomFieldDef[]): Array<{ value: string; label: string; group: "Contacto" | "Campos personalizados" }> {
  const fixed = FIXED_TARGETS.filter((t) => targetAccepts(field, t)).map((t) => ({ value: t, label: FIXED_TARGET_LABELS[t], group: "Contacto" as const }));
  const custom = customFields
    .filter((c) => targetAccepts(field, `${CUSTOM_PREFIX}${c.slug}`, c.type))
    .map((c) => ({ value: `${CUSTOM_PREFIX}${c.slug}`, label: c.name, group: "Campos personalizados" as const }));
  return [...fixed, ...custom];
}

/** Los datos con los que se puede BUSCAR o CREAR un contacto (el orden de búsqueda lo fija la base). */
export const IDENTIFIER_TARGETS = [
  "contact.phone",
  "contact.whatsapp_phone",
  "contact.email",
  ...SOCIAL_LOOKUP_PLATFORMS.map((p) => SOCIAL_TARGET[p]),
] as readonly string[];

/** Sugerencia al crear: los campos de email y teléfono se mapean solos; `nombre`/`name` al nombre. */
export function suggestContactMap(fields: FormField[]): MapEntry[] {
  const map: MapEntry[] = [];
  const used = new Set<string>();
  const add = (field: FormField | undefined, target: string) => {
    if (!field || used.has(target)) return;
    map.push({ fieldKey: field.key, target });
    used.add(target);
  };
  add(fields.find((f) => f.type === "email"), "contact.email");
  add(fields.find((f) => f.type === "phone"), "contact.phone");
  for (const f of fields) if (f.type === "social" && f.social) add(f, SOCIAL_TARGET[f.social.platform]);
  add(fields.find((f) => (f.type === "short_text" || f.type === "hidden") && ["nombre", "name", "nombre_completo", "full_name"].includes(f.key)), "contact.display_name");
  return map;
}

/** ¿Alguna respuesta va a poder crear o vincular un contacto? Hace falta email, teléfono o un usuario de red social. */
export function canIdentifyContact(config: ContactConfig, fields: FormField[]): boolean {
  return config.map.some((entry) => {
    if (!IDENTIFIER_TARGETS.includes(entry.target)) return false;
    return fields.some((f) => f.key === entry.fieldKey);
  });
}

/** Los mapeos que apuntan a algo que ya no existe (campo borrado del formulario o campo personalizado borrado). */
export function brokenMappings(config: ContactConfig, fields: FormField[], customFields: CustomFieldDef[]): Array<{ fieldKey: string; reason: "field" | "custom" }> {
  const out: Array<{ fieldKey: string; reason: "field" | "custom" }> = [];
  for (const entry of config.map) {
    if (!fields.some((f) => f.key === entry.fieldKey)) out.push({ fieldKey: entry.fieldKey, reason: "field" });
    else if (isCustomTarget(entry.target) && !customFields.some((c) => c.slug === customSlugOf(entry.target))) out.push({ fieldKey: entry.fieldKey, reason: "custom" });
  }
  return out;
}

export function parseStoredContactConfig(raw: unknown): ContactConfig {
  const parsed = configSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as ContactConfig) : DEFAULT_CONTACT_CONFIG;
}
