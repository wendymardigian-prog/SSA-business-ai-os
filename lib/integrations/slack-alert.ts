/**
 * Fallos del sistema (25/11/2026, traído de RER): Slack rechaza el token del bot del negocio. Sin esto, los avisos por
 * Slack y el paso «Enviar a Slack» dejaban de salir sin que nadie se enterara (antes solo avisaba la entrega de
 * avisos, como «Una integración necesita atención»).
 *
 * Deja el error en la tarjeta de Slack (Integraciones) y avisa a Owner y Admin por «Fallos del sistema» (por campana y
 * correo: por Slack, justamente, no llega). Un aviso que no se repite en 7 días: eso también corta el bucle de un aviso
 * por Slack que falla y genera otro aviso. Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { notifySystemFailure } from "@/lib/notifications/system-alerts";

type Db = SupabaseClient<Database>;

export async function alertSlackTokenRejected(supabase: unknown, workspaceId: string): Promise<boolean> {
  try {
    await (supabase as Db)
      .from("integration_configs")
      .update({ last_error: "Slack rechazó el token del bot." })
      .eq("workspace_id", workspaceId)
      .eq("type", "slack")
      .eq("provider", "slack");
  } catch (err) {
    console.error("[slack] no pude anotar el error en la tarjeta:", err instanceof Error ? err.message : String(err));
  }
  return notifySystemFailure({
    supabase,
    workspaceId,
    type: "slack_connection_error",
    key: "slack",
    title: "Se cortó la conexión con Slack",
    body: "Slack rechaza el token del bot. No sale ningún aviso ni mensaje por Slack hasta que lo vuelvas a conectar en Integraciones › Slack.",
    area: "integrations",
  });
}
