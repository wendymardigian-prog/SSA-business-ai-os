/**
 * Los formularios que ofrece «Armar un link» de una pieza (ver `lib/attribution/piece-link-destinations.ts`): solo los
 * publicados con una versión publicada y con página pública (un fin de día no tiene). Un pausado o un borrador quedan
 * afuera: su link no deja responder.
 *
 * Lee con el cliente de la persona: la RLS (`can_view_forms`) decide. Quien llama ya chequeó `forms.view`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { PieceLinkDestination } from "@/lib/attribution/piece-link-destinations";
import { formPublicUrl } from "@/lib/forms/automation/variables";
import { isPublicFormType } from "@/lib/forms/fields";

export interface FormDestinationRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  contact_config: unknown;
}

/** El modo guardado en `contact_config`; lo que no se entiende cuenta como el default (vincula). */
function linksContacts(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return true;
  return (config as { mode?: unknown }).mode !== "none";
}

export function buildFormDestinations(rows: FormDestinationRow[], base: string): PieceLinkDestination[] {
  return rows
    .filter((f) => isPublicFormType(f.type) && f.slug?.trim())
    .map((f) => ({
      kind: "form" as const,
      id: f.id,
      label: f.name?.trim() || "Formulario sin nombre",
      url: formPublicUrl(base, f.slug.trim()),
      ...(linksContacts(f.contact_config) ? {} : { noContact: true }),
    }));
}

/** Lanza si la base falla: quien llama decide qué mostrar. */
export async function loadFormLinkDestinations(db: SupabaseClient<Database>, workspaceId: string, base: string): Promise<PieceLinkDestination[]> {
  const { data, error } = await db
    .from("forms")
    .select("id, name, slug, type, contact_config")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .not("current_version_id", "is", null)
    .order("name", { ascending: true });
  if (error) throw new Error(`no pude leer los formularios: ${error.message}`);
  return buildFormDestinations((data ?? []) as FormDestinationRow[], base);
}
