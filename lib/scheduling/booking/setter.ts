import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/**
 * Deja a `userId` como setter del contacto, solo si no tenía uno. Es un
 * UPDATE condicional (`setter_id IS NULL`): dos llamadas a la vez no se pisan
 * y un setter elegido a mano nunca se reemplaza. Devuelve si lo asignó.
 */
export async function assignSetterIfEmpty(service: Db, workspaceId: string, contactId: string, userId: string): Promise<boolean> {
  const { data, error } = await service
    .from("contacts")
    .update({ setter_id: userId })
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .is("setter_id", null)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
