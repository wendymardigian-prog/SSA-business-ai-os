import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { queueBroadcast } from "@/lib/broadcasts/core";

/**
 * POST /api/v1/broadcasts/:broadcastId/send
 *
 * Pone un borrador en la cola de envíos: congela la audiencia (con la RLS de
 * quien llama) y deja que el despachador lo mande con el ritmo del canal
 * (`lib/send-queue/dispatch.ts`). Responde enseguida; el envío sigue solo.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;

  // Permiso (Equipo y roles, F22): desde la 00285 la RLS tambien lo repite.
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const service = await createServiceClient();
  const res = await queueBroadcast(ctx.supabase, service, {
    workspaceId: ctx.workspace.id,
    id: broadcastId,
    timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ success: true, recipients: res.value.sendable, skipped: res.value.skipped });
}
