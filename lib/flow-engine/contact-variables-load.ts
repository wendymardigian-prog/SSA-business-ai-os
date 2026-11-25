/**
 * Lee de la base lo que necesitan las variables del contacto (`contact-variables.ts`). Solo servidor: el motor lo
 * llama con su cliente (el de servicio en los cron y webhooks), siempre filtrando por el workspace del flujo.
 *
 * Nunca lanza: ante cualquier error devuelve null y el flujo sigue con las variables que ya tenía. Los logs no llevan
 * datos del contacto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildContactVariables, type BuiltContactVariables, type ContactVariableSources } from "./contact-variables";

type Db = SupabaseClient<Database>;

const CONTACT_COLUMNS = [
  "id",
  "display_name",
  "email",
  "phone",
  "secondary_email",
  "whatsapp_phone",
  "instagram_username",
  "tiktok_username",
  "twitter_username",
  "linkedin_profile_url",
  "country",
  "timezone",
  "setter_id",
  "vendedor_id",
  "setter_status",
  "closer_status",
  "last_status",
  "last_status_role",
  "qualification_level",
  "lead_temperature",
].join(", ");

const CONTACT_SELECT = `${CONTACT_COLUMNS}, contact_tags(tags(name)), contact_custom_fields(value, custom_field_definitions(slug, type, deleted_at))`;

interface ContactRow extends Record<string, unknown> {
  id: string;
  setter_id: string | null;
  vendedor_id: string | null;
  contact_tags?: Array<{ tags: { name: string } | null }> | null;
  contact_custom_fields?: Array<{ value: string | null; custom_field_definitions: { slug: string; type: string; deleted_at: string | null } | null }> | null;
}

export interface LoadedContactVariables {
  /** null si el flujo no tiene contacto (o el contacto ya no existe): no se siembra `contact.*`. */
  built: BuiltContactVariables | null;
  workspaceName: string | null;
}

/** Las fuentes de las variables. Sin contacto, solo el nombre del negocio. */
export async function loadContactVariableSources(
  supabase: Db,
  contactId: string | null,
  workspaceId: string,
): Promise<{ sources: ContactVariableSources | null; workspaceName: string | null } | null> {
  try {
    const [contactRes, workspaceRes] = await Promise.all([
      contactId
        ? supabase.from("contacts").select(CONTACT_SELECT).eq("id", contactId).eq("workspace_id", workspaceId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("workspaces").select("name, contact_status_settings, qualification_settings").eq("id", workspaceId).maybeSingle(),
    ]);
    if (contactRes.error) throw new Error(contactRes.error.message);
    const workspace = workspaceRes.data as { name?: string | null; contact_status_settings?: unknown; qualification_settings?: unknown } | null;
    const row = contactRes.data as unknown as ContactRow | null;
    if (!row) return { sources: null, workspaceName: workspace?.name ?? null };

    const memberIds = [row.setter_id, row.vendedor_id].filter((id): id is string => typeof id === "string");
    const memberNames = await loadMemberNames(workspaceId, memberIds);

    const sources: ContactVariableSources = {
      contact: row as unknown as ContactVariableSources["contact"],
      tags: (row.contact_tags ?? []).map((t) => t.tags?.name ?? "").filter(Boolean),
      customFields: (row.contact_custom_fields ?? [])
        .filter((f) => f.custom_field_definitions && !f.custom_field_definitions.deleted_at)
        .map((f) => ({ slug: f.custom_field_definitions!.slug, type: f.custom_field_definitions!.type, value: f.value })),
      statusSettings: workspace?.contact_status_settings,
      qualificationSettings: workspace?.qualification_settings,
      memberNames,
    };
    return { sources, workspaceName: workspace?.name ?? null };
  } catch (error) {
    console.error("[flow-engine] no pude leer los datos del contacto para las variables:", error instanceof Error ? error.message : "error");
    return null;
  }
}

/** Los nombres del setter y el vendedor. Import dinámico: usa el cliente de servicio (igual que las variables de Ventas). */
async function loadMemberNames(workspaceId: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const { getWorkspaceMembers } = await import("@/lib/workspace-members");
    const members = await getWorkspaceMembers(workspaceId);
    return Object.fromEntries(members.filter((m) => ids.includes(m.userId)).map((m) => [m.userId, m.name]));
  } catch (error) {
    console.error("[flow-engine] no pude leer los nombres del equipo:", error instanceof Error ? error.message : "error");
    return {};
  }
}

/** Lee y arma las variables. null si la lectura falló (el flujo sigue con lo que tenía). */
export async function loadContactVariables(supabase: Db, contactId: string | null, workspaceId: string): Promise<LoadedContactVariables | null> {
  const loaded = await loadContactVariableSources(supabase, contactId, workspaceId);
  if (!loaded) return null;
  return {
    built: loaded.sources ? buildContactVariables(loaded.sources) : null,
    workspaceName: loaded.workspaceName,
  };
}
