/**
 * La foto de la persona en la Agenda: la que subio en Ajustes de Agenda
 * (`scheduling_profiles.avatar_url`, por negocio) y, si no subio ninguna, la
 * de Mi cuenta (00273). La de la agenda nunca se pisa.
 *
 * Recibe el cliente de servicio (las paginas publicas no tienen sesion) y no
 * lanza: sin foto, la pagina muestra las iniciales de siempre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { userAvatarPublicUrl } from "@/lib/account/avatar";

export async function hostAvatarUrl(
  service: SupabaseClient<Database>,
  userId: string | null | undefined,
  schedulingAvatarUrl: string | null | undefined,
): Promise<string | null> {
  if (schedulingAvatarUrl) return schedulingAvatarUrl;
  if (!userId) return null;
  try {
    const { data, error } = await service.from("user_profiles").select("avatar_path").eq("user_id", userId).maybeSingle();
    if (error) return null;
    return userAvatarPublicUrl(data?.avatar_path ?? null);
  } catch {
    return null;
  }
}
