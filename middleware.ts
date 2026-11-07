import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { appUrl } from "@/lib/app-url";
import { canonicalRedirectUrl } from "@/lib/public-url";

export async function middleware(request: NextRequest) {
  // Quien entra por el dominio de Railway termina en el principal: así los links que ve son los de su dominio y el
  // retorno de OAuth encuentra su cookie. Antes de la sesión: no hace falta preguntarle nada a Supabase.
  const target = canonicalRedirectUrl({
    url: request.url,
    method: request.method,
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    mainUrl: appUrl(),
  });
  if (target) return NextResponse.redirect(target, 307);

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
