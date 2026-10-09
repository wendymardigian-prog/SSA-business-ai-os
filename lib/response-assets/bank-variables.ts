/**
 * Las variables de la banca de recursos ({{contact.display_name}},
 * {{contact.email}}, {{contact.phone}}, {{workspace.name}}) en el texto de una
 * AUTOMATIZACION.
 *
 * Un texto de la banca que se inserta en el email o el mensaje de un flow trae
 * sus variables con esa sintaxis. `interpolateVariables` (flows) solo resuelve
 * lo que esta en `context.variables` y deja el resto tal cual a proposito; este
 * segundo pase resuelve lo que quedo, con los datos reales del contacto y del
 * negocio. Es ADITIVO: un `{{contact.display_name}}` que antes salia crudo
 * ahora sale con el nombre.
 *
 * Solo toca esas cuatro variables (la lista es cerrada en `interpolateTemplate`):
 * lo demas, incluidos los `{{booking.*}}` que no resolvieron, queda intacto.
 * Y solo consulta la base si el texto las trae.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { interpolateTemplate } from "@/lib/templates/interpolate";

type Db = SupabaseClient<Database>;

const BANK_TOKEN = /\{\{\s*(?:contact|workspace)\.[a-z_]+\s*\}\}/i;

/** ¿Trae alguna variable de la banca sin resolver? */
export function hasBankVariables(text: string): boolean {
  return BANK_TOKEN.test(text);
}

export async function resolveBankVariables(
  supabase: Db,
  context: { workspaceId: string; contactId: string },
  texts: string[],
): Promise<string[]> {
  if (!texts.some(hasBankVariables)) return texts;

  const [{ data: contact }, { data: workspace }] = await Promise.all([
    supabase.from("contacts").select("display_name, email, phone").eq("id", context.contactId).maybeSingle(),
    supabase.from("workspaces").select("name").eq("id", context.workspaceId).maybeSingle(),
  ]);

  return texts.map((text) => interpolateTemplate(text, { contact, workspace }));
}
