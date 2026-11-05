"use server";

import { logAudit } from "@/lib/audit";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { parseWhatsappImportState, type WhatsappImportActionResult } from "@/lib/whatsapp-history/import-state";
import { startWhatsappImport } from "@/lib/whatsapp-history/run-import";
import { runHistoryReview, type ReviewResult } from "@/lib/whatsapp-history/run-review";

/**
 * "Revisar historial" de un número de WhatsApp: cuántas conversaciones y mensajes
 * tiene guardados el Evolution de ese número y cuántas no están en la bandeja.
 * Solo lectura: no importa nada ni le pide nada a WhatsApp. Pide `channels.manage`
 * (lo mismo que las llamadas y Sincronizar canales); el workspace sale de la sesión.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reviewWhatsappHistory(channelId: string): Promise<ReviewResult> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "Tu rol no puede revisar los canales." };
  return runHistoryReview(await createServiceClient(), { workspaceId: ctx.workspace.id, channelId });
}

/** El avance de la importación, para la tarjeta del número. */
export async function getWhatsappImportState(channelId: string): Promise<WhatsappImportActionResult> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "Tu rol no puede revisar los canales." };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("channels")
    .select("inbox_import")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (error) return { ok: false, error: "No pude leer el avance. Probá de nuevo en un rato." };
  return { ok: true, state: parseWhatsappImportState(data?.inbox_import) };
}

const START_ERRORS = {
  not_found: "No encontré ese canal.",
  not_evolution: "Este canal no es un WhatsApp conectado por QR.",
  inactive: "Este número está apagado. Prendelo para importar.",
  running: "Ya hay una importación en marcha.",
  queue: "No pude poner la importación en la cola. Probá de nuevo en un rato.",
} as const;

/** «Importar»: arranca la importación en la cola. Pide lo mismo que revisar. */
export async function startWhatsappHistoryImport(channelId: string): Promise<WhatsappImportActionResult> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "Tu rol no puede importar conversaciones." };
  const service = await createServiceClient();
  try {
    const result = await startWhatsappImport(service, { workspaceId: ctx.workspace.id, channelId });
    if (!result.started) return { ok: false, error: START_ERRORS[result.reason] };
    await logAudit({
      supabase: service,
      workspaceId: ctx.workspace.id,
      entityType: "channel",
      entityId: channelId,
      action: "update",
      metadata: { via: "whatsapp_history_import", run_id: result.runId },
      performedBy: ctx.user.id,
    });
  } catch (err) {
    console.error("[whatsapp-import] no pude arrancar la importacion:", err instanceof Error ? err.message : err);
    return { ok: false, error: "No pude arrancar la importación. Probá de nuevo en un rato." };
  }
  return getWhatsappImportState(channelId);
}
