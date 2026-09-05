import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { channelWebhookUrl } from "@/lib/webhook-url";
import {
  EvolutionError,
  createInstance,
  getConnectionState,
  getEvolutionConfig,
  instanceNameFor,
} from "@/lib/evolution-client";

/**
 * POST /api/v1/channels/whatsapp
 *
 * Deja lista la instancia de WhatsApp del workspace y su canal en la base.
 * Es idempotente: si ya existe, la reusa y reconfigura el webhook, asi
 * "Reconectar" y "Crear instancia" hacen lo mismo sin romper nada.
 *
 * No devuelve el QR: eso lo pide la UI a /qr, que es lo que se refresca
 * mientras el usuario tiene el modal abierto.
 */
export async function POST() {
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden conectar canales" },
      { status: 403 },
    );
  }

  const config = getEvolutionConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "WhatsApp no esta configurado: faltan EVOLUTION_API_URL o EVOLUTION_API_KEY en el entorno.",
      },
      { status: 400 },
    );
  }

  const webhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
  if (!webhookToken) {
    return NextResponse.json(
      {
        error:
          "Falta EVOLUTION_WEBHOOK_TOKEN. Sin ese token el webhook queda abierto a cualquiera que descubra la URL.",
      },
      { status: 400 },
    );
  }

  const { workspace, supabase } = ctx;
  const instance = instanceNameFor(config, workspace.id);

  try {
    await createInstance(config, instance, channelWebhookUrl("evolution"), webhookToken);
  } catch (err) {
    const message = err instanceof EvolutionError ? err.message : String(err);
    console.error("[whatsapp] no pude preparar la instancia:", message);
    return NextResponse.json(
      { error: `No pude preparar la instancia de WhatsApp: ${message}` },
      { status: 502 },
    );
  }

  const state = await getConnectionState(config, instance).catch(() => "unknown" as const);
  const connectionStatus =
    state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";

  const { data: channel, error } = await supabase
    .from("channels")
    .upsert(
      {
        workspace_id: workspace.id,
        platform: "whatsapp",
        provider: "evolution",
        // late_account_id es NOT NULL y unico por workspace: para un canal que
        // no viene de Zernio se usa el nombre de la instancia con prefijo.
        late_account_id: `evolution:${instance}`,
        evolution_instance: instance,
        display_name: "WhatsApp",
        is_active: true,
        connection_status: connectionStatus,
        last_error: null,
      },
      { onConflict: "workspace_id,late_account_id" },
    )
    .select("*")
    .single();

  if (error) {
    console.error("[whatsapp] no pude guardar el canal:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channel, state });
}
