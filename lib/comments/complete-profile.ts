/**
 * Un contacto que nació por el eco de un mensaje de ManyChat no tiene nombre ni @,
 * y un comentario de esa persona sí los trae: con eso deja de estar oculto, sin
 * esperar a que responda.
 *
 * Lo que escribió una persona no se toca (`profileUpdateFor`), y un @ que ya es de
 * OTRO contacto no se escribe: esa fusión la decide una persona.
 *
 * **NUNCA lanza**: si falla, el comentario se vincula igual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { fallbackContactName, isPlaceholderName, profileUpdateFor } from "@/lib/contacts/anonymous";
import { findContact } from "@/lib/contacts/find-or-create";

export async function completeProfileFromComment(
  supabase: SupabaseClient<Database>,
  params: { workspaceId: string; contactId: string; username: string | null | undefined; name?: string | null },
): Promise<void> {
  const username = params.username?.trim().replace(/^@+/, "") ?? "";
  if (!username) return;
  try {
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("display_name, instagram_username")
      .eq("id", params.contactId)
      .maybeSingle();
    if (error) throw error;
    if (!contact || contact.instagram_username) return;

    const owner = (await findContact(supabase, { workspaceId: params.workspaceId, identity: { instagram: username } })).contactId;
    if (owner && owner !== params.contactId) return;

    const update = profileUpdateFor(contact, { name: params.name, username });
    // Sin nombre real, "@usuario": un número como nombre seguiría sin decir quién es.
    if (!update.display_name && isPlaceholderName(contact.display_name)) {
      update.display_name = fallbackContactName(null, update.instagram_username, contact.display_name ?? "");
    }

    const { error: updateError } = await supabase.from("contacts").update(update).eq("id", params.contactId);
    if (updateError) throw updateError;
  } catch (err) {
    console.error("[atribucion] no pude completar el contacto desde el comentario:", err instanceof Error ? err.message : String(err));
  }
}
