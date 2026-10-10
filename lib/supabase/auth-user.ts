import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Quien esta logueado en este request, sin ir a Supabase Auth.
 *
 * `getUser()` es un viaje de red a Auth en cada llamada, y cada pantalla del
 * dashboard pagaba tres (middleware, `getWorkspace`, la zona horaria), dos
 * una detras de la otra. `getClaims()` verifica la firma del token aca mismo
 * con la clave publica del proyecto (ES256, la JWKS se cachea), asi que es
 * igual de seguro para autorizar y no sale de la app. Si algun dia el
 * proyecto volviera a una clave simetrica, `getClaims()` cae solo a pedirle
 * a Auth: nunca es menos seguro que antes.
 *
 * Lo que se pierde: un usuario dado de baja sigue entrando hasta que vence su
 * token (1 hora). Es el mismo margen que ya tenian las policies RLS, que leen
 * el mismo token.
 *
 * Del usuario la app usa solo `id`, `email` y `user_metadata` (el nombre):
 * todo eso viaja en el token. `user_metadata` puede quedar viejo hasta que el
 * token se renueve; quien lo cambie tiene que refrescar la sesion.
 *
 * `cache()`: una sola verificacion y un solo cliente por request, compartidos
 * por el layout, la pagina y los helpers.
 */
export type AuthUser = Pick<User, "id" | "email" | "user_metadata" | "app_metadata">;

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { supabase, user: null };

  const claims = data.claims;
  const user: AuthUser = {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata ?? {},
    app_metadata: claims.app_metadata ?? {},
  };
  return { supabase, user };
});
