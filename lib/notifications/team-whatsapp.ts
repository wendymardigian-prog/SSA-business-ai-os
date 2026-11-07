/**
 * Manda un WhatsApp a una persona del EQUIPO (no a un contacto): un aviso de
 * Mi cuenta → Notificaciones, o el mensaje de prueba.
 *
 * Sale del WhatsApp que el negocio eligio en Ajustes → General
 * (`team_alerts_settings`), por el mismo tramo final que el paso «Enviar
 * WhatsApp a un número» (`sendEvolutionDirect`): no crea contactos ni
 * conversaciones.
 *
 * Cuenta en el tope UNICO del numero (`claim_automated_send`, 200 por hora,
 * `lib/channels/whatsapp-limits.ts`) y, despues de salir, corre el proximo
 * turno de la cola de broadcasts de ese numero. Si el numero ya llego al tope,
 * no manda y devuelve `rate_limited` con `retryAt` (el inicio de la hora
 * siguiente): quien llama lo reagenda.
 *
 * SOLO servidor, con el cliente de servicio. Nunca lanza y nunca loguea el numero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { sendEvolutionDirect } from "@/lib/flow-engine/send";
import { WHATSAPP_HOURLY_LIMIT, nextHourlyWindowStart } from "@/lib/channels/whatsapp-limits";
import { loadTeamAlertsChannel, type TeamAlertsChannel } from "./team-alerts";

export type TeamWhatsAppResult =
  | { ok: true }
  | { ok: false; reason: "no_channel" | "no_config" | "failed"; retryable: boolean; error: string }
  /** El numero llego al tope de la hora: no salio, y vuelve a entrar en `retryAt`. */
  | { ok: false; reason: "rate_limited"; retryable: true; retryAt: Date; error: string };

export const TEAM_WHATSAPP_RATE_LIMITED =
  "El WhatsApp de avisos llegó al tope de mensajes de esta hora (lo comparte con todo lo que sale por ese número).";

export async function sendTeamWhatsApp(
  service: SupabaseClient<Database>,
  workspaceId: string,
  number: string,
  text: string,
  channel?: TeamAlertsChannel | null,
  now: () => Date = () => new Date(),
): Promise<TeamWhatsAppResult> {
  try {
    const from = channel === undefined ? await loadTeamAlertsChannel(service, workspaceId) : channel;
    if (!from) return { ok: false, reason: "no_channel", retryable: false, error: "El negocio no tiene un WhatsApp conectado para los avisos." };
    const config = await getEvolutionConfig(service, workspaceId);
    if (!config) return { ok: false, reason: "no_config", retryable: false, error: "WhatsApp no está configurado en este negocio." };

    // El mismo tope que todo lo que sale por ese numero. Si la funcion falla (no por tope), se deja pasar, como en el
    // resto del motor: perder un aviso por un problema del contador seria peor que pasarse por uno.
    const { data: allowed, error: capError } = await service.rpc("claim_automated_send", { p_channel_id: from.id, p_limit: WHATSAPP_HOURLY_LIMIT });
    if (capError) console.error("[avisos] no pude reclamar el envío del WhatsApp, dejo pasar:", capError.message);
    else if (allowed === false) {
      return { ok: false, reason: "rate_limited", retryable: true, retryAt: nextHourlyWindowStart(now()), error: TEAM_WHATSAPP_RATE_LIMITED };
    }

    const outcome = await sendEvolutionDirect(service, config, from.instance, number, { text }, { client: service, channelId: from.id });
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
