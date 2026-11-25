/**
 * Los datos del contacto como variables de las automatizaciones (traído de RER el 25/11/2026), con la forma
 * «grupo.campo»: `{{contact.vendedor_name}}`, `{{contact.custom.presupuesto}}`. PURO: el motor le pasa lo que leyó
 * (`contact-variables-load.ts`) y esto arma el texto.
 *
 * Todo sale como texto y un dato que falta es `""` (nunca null): así la variable desaparece del mensaje y el respaldo
 * `{{contact.custom.presupuesto|sin definir}}` funciona. Los estados salen con el nombre que se ve en pantalla, un campo
 * Sí/No como «Sí»/«No» y una fecha como dd/mm/aaaa (`displayCustomValue`). No se exponen las notas internas ni el
 * resumen de la IA.
 */

import { displayCustomValue } from "@/lib/custom-fields";
import { findStatus, parseStatusSettings } from "@/lib/contacts/statuses";
import { isQualificationLevel, parseQualificationSettings, qualificationName } from "@/lib/contacts/qualification";
import { LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";
import { firstNameOf } from "./variable-catalog";

/** Lo que el motor lee de la base para armar las variables. */
export interface ContactVariableSources {
  contact: {
    id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
    secondary_email?: string | null;
    whatsapp_phone?: string | null;
    instagram_username?: string | null;
    tiktok_username?: string | null;
    twitter_username?: string | null;
    linkedin_profile_url?: string | null;
    country?: string | null;
    timezone?: string | null;
    setter_id?: string | null;
    vendedor_id?: string | null;
    setter_status?: string | null;
    closer_status?: string | null;
    last_status?: string | null;
    last_status_role?: string | null;
    qualification_level?: number | null;
    lead_temperature?: string | null;
  };
  tags?: readonly string[];
  /** Campos personalizados con valor: slug, tipo y lo guardado. */
  customFields?: ReadonlyArray<{ slug: string; type: string; value: string | null }>;
  /** `workspaces.contact_status_settings` tal como está guardado. */
  statusSettings?: unknown;
  /** `workspaces.qualification_settings` tal como está guardado. */
  qualificationSettings?: unknown;
  /** user_id → nombre visible de las personas del equipo (solo las que hacen falta). */
  memberNames?: Readonly<Record<string, string>>;
}

export interface BuiltContactVariables {
  contact: Record<string, unknown>;
}

/** Las claves de `contact.*` que vienen de la base (las que se refrescan al retomar un flujo). */
export const CONTACT_DB_KEYS = [
  "id",
  "display_name",
  "name",
  "first_name",
  "email",
  "phone",
  "secondary_email",
  "whatsapp",
  "instagram",
  "tiktok",
  "twitter",
  "linkedin",
  "country",
  "timezone",
  "tags",
  "setter_name",
  "vendedor_name",
  "setter_status",
  "vendedor_status",
  "last_status",
  "qualification",
  "qualification_level",
  "temperature",
  "custom",
] as const;

const s = (v: string | null | undefined): string => (v ?? "").trim();

/** El nombre de un estado tal como se ve, o «» si no tiene (un estado archivado conserva su nombre). */
function statusText(list: Parameters<typeof findStatus>[0], key: string | null | undefined): string {
  if (!key) return "";
  return findStatus(list, key)?.name ?? "";
}

export function buildContactVariables(src: ContactVariableSources): BuiltContactVariables {
  const c = src.contact;
  const displayName = s(c.display_name);
  const statuses = parseStatusSettings(src.statusSettings);
  const qualification = parseQualificationSettings(src.qualificationSettings);
  const names = src.memberNames ?? {};
  const custom: Record<string, string> = {};
  for (const f of src.customFields ?? []) custom[f.slug] = displayCustomValue(f.type, f.value);
  const level = c.qualification_level;
  const temperature = c.lead_temperature && c.lead_temperature in LEAD_TEMPERATURE_LABELS
    ? LEAD_TEMPERATURE_LABELS[c.lead_temperature as keyof typeof LEAD_TEMPERATURE_LABELS]
    : "";
  const lastList = c.last_status_role === "closer" ? statuses.closer : statuses.setter;

  const contact: Record<string, unknown> = {
    id: c.id,
    display_name: displayName,
    // `contact.name` lo usaban algunos ejemplos: queda como alias del nombre visible.
    name: displayName,
    first_name: firstNameOf(displayName),
    email: s(c.email),
    phone: s(c.phone),
    secondary_email: s(c.secondary_email),
    whatsapp: s(c.whatsapp_phone),
    instagram: s(c.instagram_username),
    tiktok: s(c.tiktok_username),
    twitter: s(c.twitter_username),
    linkedin: s(c.linkedin_profile_url),
    country: s(c.country),
    timezone: s(c.timezone),
    tags: (src.tags ?? []).filter(Boolean).join(", "),
    setter_name: c.setter_id ? s(names[c.setter_id]) : "",
    vendedor_name: c.vendedor_id ? s(names[c.vendedor_id]) : "",
    setter_status: statusText(statuses.setter, c.setter_status),
    vendedor_status: statusText(statuses.closer, c.closer_status),
    last_status: statusText(lastList, c.last_status),
    qualification: isQualificationLevel(level) ? qualificationName(qualification, level) : "",
    qualification_level: isQualificationLevel(level) ? String(level) : "",
    temperature,
    custom,
  };

  return { contact };
}

export type SeedMode = "existing-wins" | "fresh-wins";

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Pone `contact.*` en las variables del flujo.
 * - `existing-wins` (al arrancar): lo que ya trajo el disparador gana, como siempre (Ventas trae su `contact.first_name`).
 * - `fresh-wins` (al retomar después de una espera y después de «Crear o actualizar contacto»): los datos de la base
 *   pisan lo guardado, así un mensaje usa el vendedor de AHORA. Lo que no viene de la base (`contact.id` que dejó un
 *   paso, `contact_result`) se conserva.
 */
export function seedBuiltContactVariables(
  variables: Record<string, unknown>,
  built: BuiltContactVariables,
  mode: SeedMode,
): Record<string, unknown> {
  const next = { ...variables };
  const existing = asObject(next.contact);
  next.contact = mode === "fresh-wins" ? { ...existing, ...built.contact } : { ...built.contact, ...existing };
  return next;
}
