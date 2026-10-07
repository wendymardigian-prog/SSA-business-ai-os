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
import { getAdminContext, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { completeOAuth } from "@/lib/oauth/flow";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth/state";
import { oauthCallbackUrl } from "@/lib/webhook-url";
import { syncSocialAccounts } from "@/lib/social/accounts";
import { queueFirstRead } from "@/lib/social/sync-hook";
import { syncCalendars } from "@/lib/scheduling/data/calendars";
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

  const ctx = adapter.perUser
    ? await getPermissionAction(adapter.requiredPermission ?? "scheduling.use")
    : await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      {
        error: adapter.perUser
          ? "No tenes permiso para conectar tu calendario"
          : "Solo Owner y Admin pueden conectar cuentas",
      },
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
  // la pantalla a la que se vuelve ya muestre la cuenta nueva. Una cuenta de
  // Google Calendar, en cambio, trae sus calendarios (F5).
  if (result.ok) {
    try {
      if (adapter.perUser) {
        await syncCalendars({ supabase: service }, result.connectionId);
      } else {
        const synced = await syncSocialAccounts(service, ctx.workspace.id);
        // Una red recien conectada se lee ya, no a las 3 AM. Nunca lanza.
        await queueFirstRead(ctx.workspace.id, synced.newAccountIds, `oauth ${adapter.provider}`);
      }
    } catch (err) {
      console.error(`[oauth] ${adapter.provider}: no pude sincronizar despues de conectar:`, err);
    }
  }

  const destination = new URL(
    result.ok && adapter.perUser ? "/dashboard/agenda/configuracion/calendarios" : result.redirectTo,
    appUrl() || url.origin,
  );
  if (result.ok) destination.searchParams.set("connected", adapter.perUser ? "1" : adapter.provider);
  else destination.searchParams.set("error", result.error);

  const response = NextResponse.redirect(destination);
  // De un solo uso: sin la cookie, repetir el mismo state no vale.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
