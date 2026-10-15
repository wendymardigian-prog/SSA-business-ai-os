/**
 * La configuracion de atribucion del negocio (Extra I, F31): `workspaces.attribution_settings` (jsonb, 00230).
 *
 *   comments_create_contact   por red: si comentar crea un contacto (Instagram apagado, TikTok encendido)
 *   content_inherit_days      cuantos dias un DM hereda la pieza de la automatizacion que lo origino (F35), 1 a 30
 *   links_append_default      valor inicial de "Agregar parametros de atribucion" en un nodo de envio nuevo (F39)
 *   links_track_clicks_default  valor inicial de "Registrar el clic" (F40)
 *
 * Dos esquemas, a proposito:
 *   - `attributionSettingsSchema`  ESTRICTO: lo que valida la Server Action al GUARDAR. Un valor invalido es un error
 *     que se le muestra a la persona.
 *   - `parseAttributionSettings`   TOLERANTE: lo que lee el resto del sistema. NUNCA lanza y cae a los valores por
 *     defecto POR PARTE: un jsonb viejo, a medio llenar o con un tipo equivocado no puede frenar un comentario ni un DM.
 *
 * Modulo PURO.
 */
import { z } from "zod";

export const MIN_INHERIT_DAYS = 1;
export const MAX_INHERIT_DAYS = 30;

/** Las redes en las que se puede decidir si comentar crea un contacto. */
export const COMMENT_CONTACT_PLATFORMS = ["instagram", "tiktok"] as const;
export type CommentContactPlatform = (typeof COMMENT_CONTACT_PLATFORMS)[number];

export const attributionSettingsSchema = z.object({
  comments_create_contact: z.object({
    instagram: z.boolean(),
    tiktok: z.boolean(),
  }),
  content_inherit_days: z.number().int().min(MIN_INHERIT_DAYS).max(MAX_INHERIT_DAYS),
  links_append_default: z.boolean(),
  links_track_clicks_default: z.boolean(),
});

export type AttributionSettings = z.infer<typeof attributionSettingsSchema>;

/** Una copia nueva cada vez: nadie puede mutar los defaults compartidos. */
export function defaultAttributionSettings(): AttributionSettings {
  return {
    comments_create_contact: { instagram: false, tiktok: true },
    content_inherit_days: 7,
    links_append_default: false,
    links_track_clicks_default: true,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Un jsonb a veces llega como texto (un cliente que no lo parseo): se intenta una vez. */
function asRecord(json: unknown): Record<string, unknown> | null {
  if (isRecord(json)) return json;
  if (typeof json === "string") {
    try {
      const parsed: unknown = JSON.parse(json);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lee `attribution_settings`. NUNCA lanza. Cada parte que falte o venga mal se reemplaza por su default; lo demas
 * se conserva. Las claves desconocidas se descartan.
 */
export function parseAttributionSettings(json: unknown): AttributionSettings {
  const defaults = defaultAttributionSettings();
  try {
    const raw = asRecord(json);
    if (!raw) return defaults;

    const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

    const comments = isRecord(raw.comments_create_contact) ? raw.comments_create_contact : {};
    const days = raw.content_inherit_days;

    return {
      comments_create_contact: {
        instagram: bool(comments.instagram, defaults.comments_create_contact.instagram),
        tiktok: bool(comments.tiktok, defaults.comments_create_contact.tiktok),
      },
      content_inherit_days:
        typeof days === "number" && Number.isInteger(days) && days >= MIN_INHERIT_DAYS && days <= MAX_INHERIT_DAYS
          ? days
          : defaults.content_inherit_days,
      links_append_default: bool(raw.links_append_default, defaults.links_append_default),
      links_track_clicks_default: bool(raw.links_track_clicks_default, defaults.links_track_clicks_default),
    };
  } catch {
    return defaults;
  }
}

/**
 * ¿Un comentario de esta red crea un contacto cuando el autor no existe? Una red que no esta en la lista nunca
 * crea (solo busca): es la regla segura.
 */
export function shouldCreateFromComment(settings: AttributionSettings, platform: string | null | undefined): boolean {
  const key = typeof platform === "string" ? platform.trim().toLowerCase() : "";
  if (key === "instagram") return settings.comments_create_contact.instagram === true;
  if (key === "tiktok") return settings.comments_create_contact.tiktok === true;
  return false;
}
