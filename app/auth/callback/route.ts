import { NextResponse } from "next/server";
import { appRedirectUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { RESET_REDIRECT_PATH, RESET_REQUEST_PATH, safeNextPath } from "@/lib/account/password-reset";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(appRedirectUrl(next));
    }
  }

  // Un link de "Olvidé mi contraseña" vencido, usado, o abierto en otro navegador: pedir uno nuevo, con el aviso.
  if (next === RESET_REDIRECT_PATH) return NextResponse.redirect(appRedirectUrl(`${RESET_REQUEST_PATH}?vencido=1`));
  return NextResponse.redirect(appRedirectUrl("/login?error=auth"));
}
