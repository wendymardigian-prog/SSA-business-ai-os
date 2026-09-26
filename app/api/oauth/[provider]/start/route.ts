/**
 * Empieza la conexion con un proveedor (F9).
 *
 * Exige Owner/Admin, arma el `state` firmado, deja su nonce en una cookie
 * httpOnly y manda a la persona al proveedor. La cookie es lo que ata el
 * retorno a este navegador: sin ella, un `state` valido copiado alcanzaria.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { startOAuth } from "@/lib/oauth/flow";
import { OAUTH_STATE_COOKIE, STATE_TTL_MS } from "@/lib/oauth/state";
import { oauthCallbackUrl } from "@/lib/webhook-url";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const adapter = getOAuthAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ error: "Proveedor desconocido" }, { status: 404 });
  }

  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden conectar cuentas" },
      { status: 403 },
    );
  }

  let callbackUrl: string;
  try {
    callbackUrl = oauthCallbackUrl(adapter.provider);
  } catch (err) {
    // Pasa en desarrollo: sin dominio publico el proveedor no puede volver.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No pude armar la direccion de retorno" },
      { status: 400 },
    );
  }

  // Los secretos se leen con el service client: las RPC de Vault aceptan al
  // usuario, pero aca ya se verifico el rol y asi no depende de su sesion.
  const service = await createServiceClient();

  const result = await startOAuth({
    supabase: service,
    adapter,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    redirectTo: request.nextUrl.searchParams.get("redirect_to"),
    callbackUrl,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const response = NextResponse.redirect(result.authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, result.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // el proveedor nos devuelve por navegacion: strict la perderia
    path: "/api/oauth",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return response;
}
