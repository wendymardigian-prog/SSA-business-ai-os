import { cache } from "react";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { userAvatarPublicUrl } from "@/lib/account/avatar";

/**
 * El perfil de quien esta logueado (00273), con el cliente de la sesion: la
 * RLS deja leer solo la fila propia. Sin fila (nunca guardo nada), todo vacio.
 *
 * Solo para el servidor (lee la sesion). Cacheado por request: lo piden el
 * layout (la foto del menu) y la pagina Mi cuenta.
 */
export interface MyProfile {
  avatarPath: string | null;
  avatarUrl: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  whatsappSameAsPhone: boolean;
}

export const EMPTY_PROFILE: MyProfile = {
  avatarPath: null,
  avatarUrl: null,
  phone: null,
  whatsappPhone: null,
  whatsappSameAsPhone: true,
};

export const getMyProfile = cache(async (): Promise<MyProfile> => {
  const { supabase, user } = await getAuthUser();
  if (!user) return EMPTY_PROFILE;

  const { data, error } = await supabase
    .from("user_profiles")
    .select("avatar_path, phone, whatsapp_phone, whatsapp_same_as_phone")
    .eq("user_id", user.id)
    .maybeSingle();

  // Una base sin la 00273 o un error de red no pueden tumbar el panel: queda sin foto.
  if (error) {
    console.error("[cuenta] no pude leer el perfil:", error.message);
    return EMPTY_PROFILE;
  }
  if (!data) return EMPTY_PROFILE;

  return {
    avatarPath: data.avatar_path,
    avatarUrl: userAvatarPublicUrl(data.avatar_path),
    phone: data.phone,
    whatsappPhone: data.whatsapp_phone,
    whatsappSameAsPhone: data.whatsapp_same_as_phone,
  };
});
