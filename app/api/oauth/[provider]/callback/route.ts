/**
 * El retorno del proveedor (F9).
 *
 * Valida el `state` (firma, vencimiento, usuario, workspace y el nonce contra
 * la cookie), cambia el codigo por un token, guarda todo y vuelve a la
 * pantalla con `?connected=` o `?error=`.
 *
 * La cookie se borra siempre, salga bien o mal: asi el mismo `state` no se
 * puede usar dos veces.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { completeOAuth } from "@/lib/oauth/flow";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth/state";
import { oauthCallbackUrl } from "@/lib/webhook-url";
import { syncSocialAccounts } from "@/lib/social/accounts";
import { appUrl } from "@/lib/app-url";

const FALLBACK = "/dashboard/settings/integrations";

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

  const url = request.nextUrl;
  const service = await createServiceClient();

  const result = await completeOAuth({
    supabase: service,
    adapter,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    providerError: url.searchParams.get("error"),
    cookieNonce: request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    callbackUrl: oauthCallbackUrl(adapter.provider),
  });

  // Conectar cambia por donde se puede publicar: se recalcula ahora, para que
  // la pantalla a la que se vuelve ya muestre la cuenta nueva.
  if (result.ok) {
    try {
      await syncSocialAccounts(service, ctx.workspace.id);
    } catch (err) {
      console.error("[oauth] no pude sincronizar las cuentas sociales:", err);
    }
  }

  const destination = new URL(result.redirectTo, appUrl() || url.origin);
  if (result.ok) destination.searchParams.set("connected", adapter.provider);
  else destination.searchParams.set("error", result.error);

  const response = NextResponse.redirect(destination);
  // De un solo uso: sin la cookie, repetir el mismo state no vale.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
