import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getConnectionState, getEvolutionConfig } from "@/lib/evolution-client";
import { notifyWorkspaceAdmins } from "@/lib/notifications";

/**
 * GET /api/cron/whatsapp-health?key=CRON_SECRET
 *
 * Le pregunta a Evolution como esta cada instancia de WhatsApp y actualiza el
 * canal. Existe ademas del webhook connection.update porque una caida no
 * siempre genera evento: si el contenedor de Evolution se reinicia o el webhook
 * no llega, sin este chequeo el canal se quedaria diciendo "conectado" para
 * siempre mientras los mensajes se pierden.
 *
 * A los admins se les avisa una sola vez por caida (disconnected_notified_at),
 * y el contador se limpia al reconectar para que la proxima vez vuelva a avisar.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    request.nextUrl.searchParams.get("key") ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!cronSecret || provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getEvolutionConfig();
  if (!config) {
    // Sin Evolution configurado no hay nada que chequear; no es un error.
    return NextResponse.json({ ok: true, skipped: "Evolution no configurado" });
  }

  const supabase = await createServiceClient();

  const { data: channels, error } = await supabase
    .from("channels")
    .select("id, workspace_id, display_name, evolution_instance, connection_status, disconnected_notified_at")
    .eq("provider", "evolution")
    .not("evolution_instance", "is", null);

  if (error) {
    console.error("[whatsapp-health] no pude leer los canales:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let checked = 0;
  let notified = 0;

  for (const channel of channels ?? []) {
    checked++;
    let state: string;
    try {
      state = await getConnectionState(config, channel.evolution_instance!);
    } catch (err) {
      console.error(`[whatsapp-health] ${channel.evolution_instance}:`, err);
      continue;
    }

    const now = new Date().toISOString();

    if (state === "open") {
      if (channel.connection_status !== "connected") {
        await supabase
          .from("channels")
          .update({
            connection_status: "connected",
            last_connected_at: now,
            last_error: null,
            disconnected_notified_at: null,
          })
          .eq("id", channel.id);
      }
      continue;
    }

    if (state === "connecting") {
      // Todavia esta negociando: no es una caida, no hay que alarmar.
      continue;
    }

    const wasConnected = channel.connection_status === "connected";
    await supabase
      .from("channels")
      .update({
        connection_status: "disconnected",
        last_error:
          channel.connection_status === "disconnected"
            ? undefined
            : "WhatsApp se desconecto. Hay que volver a escanear el QR.",
      })
      .eq("id", channel.id);

    // Un solo aviso por caida.
    if (!channel.disconnected_notified_at) {
      await supabase
        .from("channels")
        .update({ disconnected_notified_at: now })
        .eq("id", channel.id);

      await notifyWorkspaceAdmins({
        supabase,
        workspaceId: channel.workspace_id,
        kind: "channel_disconnected",
        title: "WhatsApp se desconecto",
        body: `El canal "${channel.display_name ?? "WhatsApp"}" perdio la conexion. Los mensajes que lleguen mientras tanto no se reciben. Entra a Canales y volve a escanear el QR para reconectarlo.`,
        metadata: { channelId: channel.id, previousStatus: channel.connection_status, wasConnected },
      });
      notified++;
    }
  }

  return NextResponse.json({ ok: true, checked, notified });
}
