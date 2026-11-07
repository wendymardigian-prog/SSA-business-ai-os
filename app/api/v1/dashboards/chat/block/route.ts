/**
 * Un bloque suelto del dashboard de Chat.
 *
 * Lo usan el "Reintentar" de un bloque y los bloques que se piden al llegar con el
 * scroll. Es una ruta y no una Server Action porque las acciones corren de a una y
 * una navegacion puede dejarlas colgadas; `fetch` se puede cancelar al cambiar de
 * filtro.
 *
 * Primero `getActiveWorkspace`: `getWorkspace` redirige, y el navegador recibiria
 * el HTML del login en lugar de un 401. El workspace sale siempre de la sesion y
 * los datos se leen con el cliente del usuario, asi la RLS acota lo que ve cada quien.
 */

import { NextRequest, NextResponse } from "next/server";
import { getActiveWorkspace } from "@/lib/workspace";
import { getPermissionAction } from "@/lib/auth/guards";
import { parseDashboardFilters } from "@/lib/dashboards/url-state";
import { chatBlockContextFromSession, loadChatBlock } from "@/lib/dashboards/chat/blocks";
import { isChatBlockKey } from "@/lib/dashboards/chat/block-keys";
import { readChatGenerations } from "@/lib/dashboards/chat/generation";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const active = await getActiveWorkspace();
  if (!active) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE });

  const session = await getPermissionAction("dashboards.chat.view");
  if (!session) return NextResponse.json({ error: "Sin permiso" }, { status: 403, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const block = params.get("block");
  if (!isChatBlockKey(block)) return NextResponse.json({ error: "Bloque inválido" }, { status: 400, headers: NO_STORE });

  const ctx = await chatBlockContextFromSession(
    session,
    parseDashboardFilters(params),
    await readChatGenerations(),
    params.get("fresh") === "1",
  );
  return NextResponse.json(await loadChatBlock(block, ctx), { headers: NO_STORE });
}
