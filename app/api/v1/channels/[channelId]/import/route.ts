import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { startInboxImport } from "@/lib/inbox-import/run";

/**
 * POST /api/v1/channels/[channelId]/import
 *
 * "Reintentar" de la tarjeta del canal: vuelve a arrancar la importacion de
 * conversaciones de Zernio de ese canal (00267). Pide lo mismo que Sincronizar
 * canales (`channels.manage`). El workspace sale de la sesion: un canal de otro
 * negocio no se encuentra. Si ya hay una importacion corriendo, no se arma otra.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden importar conversaciones" },
      { status: 403 },
    );
  }

  try {
    const result = await startInboxImport(
      await createServiceClient(),
      { workspaceId: ctx.workspace.id, channelId },
      { pass: "auto" },
    );

    if (result.started) return NextResponse.json({ ok: true });

    switch (result.reason) {
      case "running":
        return NextResponse.json({ ok: true, alreadyRunning: true });
      case "not_found":
        return NextResponse.json({ error: "No encontré ese canal" }, { status: 404 });
      case "inactive":
        return NextResponse.json({ error: "El canal está desactivado. Activalo y volvé a probar." }, { status: 400 });
      case "not_zernio":
        return NextResponse.json({ error: "Este canal no trae conversaciones de Zernio." }, { status: 400 });
      case "queue":
        return NextResponse.json({ error: "No pude poner la importación en la cola. Probá de nuevo en un rato." }, { status: 503 });
    }
  } catch (err) {
    console.error("[channels/import] no pude arrancar la importacion:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No pude arrancar la importación. Probá de nuevo en un rato." }, { status: 500 });
  }
}
