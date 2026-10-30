/**
 * Desde que WhatsApp del negocio se le avisa al equipo (`workspaces.team_alerts_settings`, 00274).
 * PURO: lo leen Ajustes → General, Mi cuenta y el job de entrega.
 */

export interface TeamAlertsSettings {
  /** El canal de WhatsApp (Evolution) que manda los avisos. Sin canal, nadie recibe avisos por WhatsApp. */
  whatsappChannelId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTeamAlertsSettings(raw: unknown): TeamAlertsSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const id = obj.whatsapp_channel_id;
  return { whatsappChannelId: typeof id === "string" && UUID.test(id) ? id : null };
}

export function serializeTeamAlertsSettings(settings: TeamAlertsSettings): { whatsapp_channel_id: string | null } {
  return { whatsapp_channel_id: settings.whatsappChannelId };
}
