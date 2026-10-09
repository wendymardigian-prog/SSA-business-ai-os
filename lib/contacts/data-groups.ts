/**
 * Los datos del contacto que se ven y se editan EN LA FICHA, agrupados por tema.
 *
 * Antes eran quince campos detras del boton "Editar": una pantalla aparte (y sin
 * scroll) que escondia datos importantes. Ahora cada uno se ve y se edita donde
 * se lee, en la seccion "Datos de contacto".
 *
 * Tres campos no estan aca porque viven en otro lado de la ficha:
 *   - `display_name`: el titulo (se edita haciendole clic);
 *   - `lead_temperature` y `next_followup_date`: la caja "Seguimiento".
 * `FIELDS_ELSEWHERE` lo dice, y un test comprueba que cada campo editable de
 * `CONTACT_FIELDS` esta en exactamente un lugar: si se suma un campo y nadie lo
 * ubica, se pone rojo, en vez de quedar sin pantalla donde editarlo.
 *
 * Puro: sin React ni base.
 */

import type { ContactFieldKey } from "@/lib/contacts/fields";

export interface ContactDataField {
  key: ContactFieldKey;
  /** Con acento y en castellano: es lo que lee la persona. */
  label: string;
  hint?: string;
  /** Un texto largo (varios renglones). */
  multiline?: boolean;
  /** Se muestra antes del valor ("@" en un usuario). */
  prefix?: string;
}

export interface ContactDataGroup {
  id: "contacto" | "redes" | "agente";
  title: string;
  fields: ContactDataField[];
}

export const CONTACT_DATA_GROUPS: ContactDataGroup[] = [
  {
    id: "contacto",
    title: "Contacto",
    fields: [
      { key: "email", label: "Email" },
      { key: "secondary_email", label: "Email secundario" },
      { key: "phone", label: "Teléfono", hint: "Con código de país, ej: +54 9 11 2233 4455" },
      { key: "whatsapp_phone", label: "WhatsApp", hint: "Solo si es distinto al teléfono principal" },
      { key: "country", label: "País" },
    ],
  },
  {
    id: "redes",
    title: "Redes",
    fields: [
      { key: "instagram_username", label: "Instagram", prefix: "@", hint: "Sin la arroba" },
      { key: "tiktok_username", label: "TikTok", prefix: "@", hint: "Sin la arroba" },
      { key: "twitter_username", label: "Twitter / X", prefix: "@", hint: "Sin la arroba" },
      { key: "facebook_id", label: "Facebook" },
      { key: "youtube_channel_id", label: "Canal de YouTube" },
      { key: "linkedin_profile_url", label: "LinkedIn", hint: "URL completa del perfil" },
    ],
  },
  {
    id: "agente",
    title: "Resumen del agente IA",
    fields: [{ key: "ai_conversation_summary", label: "Resumen del agente IA", multiline: true }],
  },
];

/** Los campos que se editan en otra parte de la ficha, y donde. */
export const FIELDS_ELSEWHERE: Partial<Record<ContactFieldKey, string>> = {
  display_name: "el título de la ficha",
  lead_temperature: "la caja Seguimiento",
  next_followup_date: "la caja Seguimiento",
};

/**
 * A donde lleva un dato, si es un link: el perfil de la red, un correo, un
 * telefono. null si no hay a donde llevar (un pais, un resumen).
 */
export function contactFieldHref(key: ContactFieldKey, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  switch (key) {
    case "email":
    case "secondary_email":
      return `mailto:${v}`;
    case "phone":
      return `tel:${v.replace(/[^\d+]/g, "")}`;
    case "whatsapp_phone": {
      const digits = v.replace(/\D/g, "");
      return digits ? `https://wa.me/${digits}` : null;
    }
    case "instagram_username":
      return `https://instagram.com/${encodeURIComponent(v)}`;
    case "tiktok_username":
      return `https://www.tiktok.com/@${encodeURIComponent(v)}`;
    case "twitter_username":
      return `https://x.com/${encodeURIComponent(v)}`;
    case "linkedin_profile_url":
      // Solo un link web: lo que se guarda lo normaliza el servidor, pero un valor
      // viejo con `javascript:` no puede terminar como href.
      return /^https?:\/\//i.test(v) ? v : null;
    default:
      return null;
  }
}
