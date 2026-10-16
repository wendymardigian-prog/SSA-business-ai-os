import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { channelWebhookUrl } from "@/lib/webhook-url";
import {
  EvolutionError,
  createInstance,
  getConnectionState,
} from "@/lib/evolution-client";
import {
  MAX_WHATSAPP_NUMBERS,
  instanceNameForNumber,
  pendingWhatsappName,
  randomInstanceSuffix,
} from "@/lib/whatsapp-numbers";
import { getEvolutionConfig, getEvolutionWebhookToken } from "@/lib/evolution-config";

/**
 * POST /api/v1/channels/whatsapp
 *
 * Deja lista una instancia de WhatsApp y su canal en la base. Un workspace puede tener VARIOS numeros: cada uno es
 * su propia instancia de Evolution y su propio canal.
 *
 *  - Sin cuerpo: agrega un numero NUEVO (el primero conserva el nombre de instancia de siempre; los demas llevan un
 *    sufijo propio). Hay un tope de `MAX_WHATSAPP_NUMBERS`.
 *  - Con `{ channelId }`: reconecta ESE numero. Es idempotente: reusa la instancia (o la vuelve a crear si la
 *    borraron del servidor) y reconfigura el webhook, sin tocar el nombre del canal.
 *
 * No devuelve el QR: eso lo pide la UI a /qr, que es lo que se refresca
 * mientras el usuario tiene el modal abierto.
 */
export async function POST(request: Request) {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden conectar canales" },
      { status: 403 },
    );
  }

  // Las claves se leen con el de servicio: desde la 00143 `read_secret` solo
  // la ejecuta el servidor. El workspace sale del guard de Admin, no del pedido.
  const service = await createServiceClient();
  const config = await getEvolutionConfig(service, ctx.workspace.id);
  if (!config) {
    return NextResponse.json(
      {
        error:
          "WhatsApp no esta configurado: faltan EVOLUTION_API_URL o EVOLUTION_API_KEY en el entorno.",
      },
      { status: 400 },
    );
  }

  // El token sale de Vault y, si no hay, del entorno (F4): es el mismo que
  // despues valida el receptor.
  const webhookToken = await getEvolutionWebhookToken(service, ctx.workspace.id);
  if (!webhookToken) {
    return NextResponse.json(
      {
        error:
          "Falta EVOLUTION_WEBHOOK_TOKEN. Sin ese token el webhook queda abierto a cualquiera que descubra la URL.",
      },
      { status: 400 },
    );
  }

  const { workspace, supabase, user } = ctx;

  const body = (await request.json().catch(() => null)) as { channelId?: unknown } | null;
  const channelId = typeof body?.channelId === "string" && body.channelId ? body.channelId : null;

  const { data: existing, error: existingError } = await supabase
    .from("channels")
    .select("id, evolution_instance")
    .eq("workspace_id", workspace.id)
    .eq("provider", "evolution");
  if (existingError) {
    console.error("[whatsapp] no pude leer los numeros conectados:", existingError.message);
    return NextResponse.json({ error: "No pude leer los numeros de WhatsApp conectados." }, { status: 500 });
  }
  const numbers = existing ?? [];

  let instance: string;
  // Solo un numero nuevo lleva nombre: al reconectar no se pisa el que ya tiene.
  let newName: string | null = null;
  if (channelId) {
    const target = numbers.find((c) => c.id === channelId);
    if (!target?.evolution_instance) {
      return NextResponse.json({ error: "Ese numero de WhatsApp no existe." }, { status: 404 });
    }
    instance = target.evolution_instance;
  } else {
    if (numbers.length >= MAX_WHATSAPP_NUMBERS) {
      return NextResponse.json(
        { error: `Llegaste al maximo de ${MAX_WHATSAPP_NUMBERS} numeros de WhatsApp. Elimina uno para agregar otro.` },
        { status: 400 },
      );
    }
    instance = instanceNameForNumber({
      prefix: config.instancePrefix,
      workspaceId: workspace.id,
      existingCount: numbers.length,
      suffix: randomInstanceSuffix(),
    });
    newName = pendingWhatsappName(numbers.length);
  }

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
        ...(newName ? { display_name: newName } : {}),
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

  // F20: conectar un canal es de las cosas que despues nadie se acuerda quien
  // hizo, y es justo la que hay que poder reconstruir cuando deja de llegar
  // un mensaje.
  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: channel.id,
    action: "create",
    metadata: { platform: "whatsapp", provider: "evolution", instance, connection_status: connectionStatus, new_number: !channelId },
    performedBy: user.id,
  });

  return NextResponse.json({ channel, state });
}
