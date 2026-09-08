/**
 * Busqueda del contacto que ya existe detras de un email o un telefono (F19).
 *
 * La regla del proyecto es que un contacto se deduplica por dato fuerte y nunca
 * por nombre. Esta funcion es la version para lo que entra por la app: el alta
 * a mano y la importacion de CSV.
 *
 * Por que no se usa find_or_link_contact, que hace lo mismo para los mensajes
 * entrantes: esa funcion pide un channel_id y escribe en contact_channels, y
 * una fila de una planilla no viene de ningun canal. Comparten el criterio
 * (telefono o email exactos, nunca el nombre) pero no el trabajo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DuplicateSearch {
  supabase: SupabaseClient;
  workspaceId: string;
  /** Telefonos a buscar, ya normalizados. */
  phones?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
  /** Campos extra a traer del contacto encontrado, ademas del id. */
  select?: string;
}

/**
 * Devuelve el contacto existente que comparte telefono o email, o null.
 *
 * Busca en los dos telefonos y en los dos emails del contacto: alguien cargado
 * con su email secundario tiene que encontrarse igual, o el duplicado aparece
 * igual pero mas tarde y con la historia partida en dos.
 */
export async function findDuplicateContact({
  supabase,
  workspaceId,
  phones = [],
  emails = [],
  select = "id",
}: DuplicateSearch): Promise<Record<string, unknown> | null> {
  const filters: string[] = [];

  for (const phone of phones) {
    if (!phone) continue;
    filters.push(`phone.eq.${phone}`, `whatsapp_phone.eq.${phone}`);
  }
  for (const email of emails) {
    if (!email) continue;
    filters.push(`email.eq.${email}`, `secondary_email.eq.${email}`);
  }

  if (filters.length === 0) return null;

  const { data, error } = await supabase
    .from("contacts")
    .select(select)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .or(filters.join(","))
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[contacts] busqueda de duplicado fallida:", error.message);
    return null;
  }

  return (data as Record<string, unknown> | null) ?? null;
}
