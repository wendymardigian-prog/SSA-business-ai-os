import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RESET_REDIRECT_PATH, RESET_REQUEST_PATH } from "@/lib/account/password-reset";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Un link de "Olvidé mi contraseña" vencido, usado, o abierto en otro navegador: pedir uno nuevo, con el aviso.
  if (next === RESET_REDIRECT_PATH) return NextResponse.redirect(`${origin}${RESET_REQUEST_PATH}?vencido=1`);
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
