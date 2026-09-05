import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import {
  EvolutionError,
  getConnectionState,
  getEvolutionConfig,
  getQrCode,
} from "@/lib/evolution-client";

/**
 * GET /api/v1/channels/whatsapp/[channelId]/qr
 *
 * QR para vincular el telefono. La UI lo consulta cada pocos segundos mientras
 * el modal esta abierto, porque el QR de WhatsApp caduca y Evolution genera uno
 * nuevo. Si la instancia ya esta conectada devuelve state 'open' sin QR, que es
 * la señal para que el modal se cierre.
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
    .select("id, evolution_instance")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "evolution")
    .maybeSingle();

  if (!channel?.evolution_instance) {
    return NextResponse.json({ error: "Canal de WhatsApp no encontrado" }, { status: 404 });
  }

  try {
    const state = await getConnectionState(config, channel.evolution_instance);
    if (state === "open") {
      await ctx.supabase
        .from("channels")
        .update({
          connection_status: "connected",
          last_connected_at: new Date().toISOString(),
          last_error: null,
          disconnected_notified_at: null,
        })
        .eq("id", channel.id);
      return NextResponse.json({ state, qr: null });
    }

    const qr = await getQrCode(config, channel.evolution_instance);
    await ctx.supabase
      .from("channels")
      .update({ connection_status: "connecting" })
      .eq("id", channel.id);

    return NextResponse.json({ state, qr });
  } catch (err) {
    const message = err instanceof EvolutionError ? err.message : String(err);
    console.error("[whatsapp] no pude traer el QR:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
