import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { getConnectionState, getEvolutionConfig } from "@/lib/evolution-client";

/**
 * GET /api/v1/channels/whatsapp/[channelId]/status
 *
 * Estado real, preguntandole a Evolution. El webhook connection.update ya
 * mantiene la columna al dia, pero esto sirve para el boton "Actualizar" y para
 * cuando el webhook no llego (por ejemplo si la instancia se creo antes de que
 * el webhook estuviera configurado).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Solo Owner y Admin" }, { status: 403 });
  }

  const config = getEvolutionConfig();
  if (!config) {
    return NextResponse.json({ error: "WhatsApp no esta configurado" }, { status: 400 });
  }

  const { data: channel } = await ctx.supabase
    .from("channels")
    .select("id, evolution_instance, connection_status")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "evolution")
    .maybeSingle();

  if (!channel?.evolution_instance) {
    return NextResponse.json({ error: "Canal de WhatsApp no encontrado" }, { status: 404 });
  }

  try {
    const state = await getConnectionState(config, channel.evolution_instance);
    const connectionStatus =
      state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";

    if (connectionStatus !== channel.connection_status) {
      await ctx.supabase
        .from("channels")
        .update({
          connection_status: connectionStatus,
          ...(connectionStatus === "connected"
            ? {
                last_connected_at: new Date().toISOString(),
                last_error: null,
                disconnected_notified_at: null,
              }
            : {}),
        })
        .eq("id", channel.id);
    }

    return NextResponse.json({ state, connectionStatus });
  } catch (err) {
    console.error("[whatsapp] no pude consultar el estado:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
