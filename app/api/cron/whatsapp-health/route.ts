import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getConnectionState, type EvolutionConfig } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { notifyWorkspaceAdmins } from "@/lib/notifications";

/**
 * GET /api/cron/whatsapp-health
 *
 * Autenticacion: header `Authorization: Bearer <CRON_SECRET>`. La query string
 * `?key=` ya no autoriza (un secreto en la URL queda en los logs del proxy y en
 * la tabla de pg_net). Lo manda asi private.call_app_cron, migracion 00036.
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
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();

  // La configuracion es por workspace (F4), y este cron recorre los canales de
  // todos. Se resuelve una vez por workspace y se reusa: son una consulta a
  // integration_configs y una lectura de Vault cada una.
  const configByWorkspace = new Map<string, EvolutionConfig | null>();
  const configFor = async (workspaceId: string) => {
    if (!configByWorkspace.has(workspaceId)) {
      configByWorkspace.set(workspaceId, await getEvolutionConfig(supabase, workspaceId));
    }
    return configByWorkspace.get(workspaceId) ?? null;
  };

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
    const config = await configFor(channel.workspace_id);
    // Un workspace sin Evolution configurado no es un error: no hay nada que
    // chequear ahi.
    if (!config) continue;

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

        // Sin autor: lo detecto el cron, no una persona (F20).
        await logAudit({
          supabase, workspaceId: channel.workspace_id, entityType: "channel",
          entityId: channel.id, action: "update",
          changes: { connection_status: { old: channel.connection_status, new: "connected" } },
          metadata: { via: "health_check" },
          performedBy: null,
        });
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

    // Solo la caida, no cada pasada del cron encontrandolo caido.
    if (wasConnected) {
      await logAudit({
        supabase, workspaceId: channel.workspace_id, entityType: "channel",
        entityId: channel.id, action: "update",
        changes: { connection_status: { old: "connected", new: "disconnected" } },
        metadata: { via: "health_check", state },
        performedBy: null,
      });
    }

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
        // entityId para que la notificacion linkee derecho a Canales.
        entityId: channel.id,
        metadata: { channelId: channel.id, previousStatus: channel.connection_status, wasConnected },
      });
      notified++;
    }
  }

  return NextResponse.json({ ok: true, checked, notified });
}
