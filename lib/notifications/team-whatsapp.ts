/**
 * Manda un WhatsApp a una persona del EQUIPO (no a un contacto): un aviso de
 * Mi cuenta → Notificaciones, o el mensaje de prueba.
 *
 * Sale del WhatsApp que el negocio eligio en Ajustes → General
 * (`team_alerts_settings`), por el mismo tramo final que el paso «Enviar
 * WhatsApp a un número» (`sendEvolutionDirect`): no crea contactos ni
 * conversaciones, y no pasa por el tope de envios automaticos de los leads.
 *
 * SOLO servidor, con el cliente de servicio. Nunca lanza y nunca loguea el numero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { sendEvolutionDirect } from "@/lib/flow-engine/send";
import { loadTeamAlertsChannel, type TeamAlertsChannel } from "./team-alerts";

export type TeamWhatsAppResult =
  | { ok: true }
  | { ok: false; reason: "no_channel" | "no_config" | "failed"; retryable: boolean; error: string };

export async function sendTeamWhatsApp(
  service: SupabaseClient<Database>,
  workspaceId: string,
  number: string,
  text: string,
  channel?: TeamAlertsChannel | null,
): Promise<TeamWhatsAppResult> {
  try {
    const from = channel === undefined ? await loadTeamAlertsChannel(service, workspaceId) : channel;
    if (!from) return { ok: false, reason: "no_channel", retryable: false, error: "El negocio no tiene un WhatsApp conectado para los avisos." };
    const config = await getEvolutionConfig(service, workspaceId);
    if (!config) return { ok: false, reason: "no_config", retryable: false, error: "WhatsApp no está configurado en este negocio." };
    const outcome = await sendEvolutionDirect(service, config, from.instance, number, { text });
    if (outcome.ok) return { ok: true };
    return {
      ok: false,
      reason: "failed",
      retryable: outcome.failure?.retryable ?? true,
      error: outcome.failure?.message ?? "No se pudo mandar el WhatsApp.",
    };
  } catch (err) {
    console.error("[avisos] fallo mandando un WhatsApp al equipo:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "failed", retryable: true, error: "No se pudo mandar el WhatsApp." };
  }
}
