import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseConfirmType, RESET_REQUEST_PATH, safeNextPath } from "@/lib/account/password-reset";

/**
 * El link de los emails de Supabase Auth con `token_hash` (la plantilla en
 * español de "Restablecer contraseña", ver docs/cuenta-y-notificaciones.md).
 *
 * A diferencia de `/auth/callback` (el link por defecto, que necesita abrirse
 * en el MISMO navegador en el que se pidio), este funciona desde cualquier
 * navegador: el token viaja en el link y se verifica aca.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = parseConfirmType(searchParams.get("type"));
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Un link de recuperacion vencido o usado vuelve a pedir uno nuevo, con el aviso.
  if (type === "recovery") return NextResponse.redirect(`${origin}${RESET_REQUEST_PATH}?vencido=1`);
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
