"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
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
