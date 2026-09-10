import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { createNotification } from "@/lib/notifications/create";

/**
 * Deriva la conversacion a una persona.
 *
 * Pausa la automatizacion de la conversacion y cierra la sesion: a partir de
 * aca contesta alguien del equipo. La marca que deja (is_automation_paused) es
 * la misma que mira runInboundAutomation para no meterse cuando un humano tomo
 * la conversacion.
 *
 * Y avisa (F18). Sin el aviso, derivar a una persona significaba que la
 * conversacion se quedaba esperando hasta que alguien la encontrara mirando la
 * bandeja: justo lo contrario de lo que el nodo promete.
 */
export const humanTakeoverNode: NodeDefinition<unknown> = {
  type: "humanTakeover",
  label: "Derivar a una persona",
  aliases: [{ nodeType: "action", actionType: "humanTakeover" }],
  async execute({ supabase, context, sessionId }: NodeExecutionArgs<unknown>) {
    await supabase
      .from("conversations")
      .update({ is_automation_paused: true })
      .eq("id", context.conversationId);

    await supabase
      .from("flow_sessions")
      .update({ human_takeover_at: new Date().toISOString(), status: "completed" })
      .eq("id", sessionId);

    await notifyTakeover({ supabase, context });

    return "pause";
  },
};

/**
 * El aviso de que hay que atender la conversacion.
 *
 * Va DESPUES de pausar y cerrar la sesion, y no lanza nunca: si el aviso
 * fallara antes, la conversacion quedaria sin derivar, que es peor que
 * derivarla sin avisar.
 *
 * Se dirige al agente asignado si lo hay; si no, a los admins (recipientId
 * null). Asi un Member que tiene la conversacion se entera, y la RLS igual
 * deja verla a Owner/Admin.
 */
async function notifyTakeover({
  supabase,
  context,
}: Pick<NodeExecutionArgs<unknown>, "supabase" | "context">) {
  try {
    // Dos datos para que el aviso se entienda sin abrirlo: a quien esta
    // asignada y de quien es la conversacion.
    const [{ data: conversation }, { data: contact }] = await Promise.all([
      supabase
        .from("conversations")
        .select("assigned_to")
        .eq("id", context.conversationId)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("display_name, instagram_username")
        .eq("id", context.contactId)
        .maybeSingle(),
    ]);

    const nombre =
      contact?.display_name ||
      (contact?.instagram_username ? `@${contact.instagram_username}` : null) ||
      "Un contacto";

    await createNotification({
      supabase,
      workspaceId: context.workspaceId,
      type: "human_takeover",
      title: `${nombre} necesita que le contesten`,
      body: "La automatizacion derivo esta conversacion a una persona y quedo pausada. Abrila y segui vos.",
      entityType: "conversation",
      entityId: context.conversationId,
      recipientId: conversation?.assigned_to ?? null,
      metadata: {
        contact_id: context.contactId,
        channel_id: context.channelId,
        flow_id: context.flowId,
      },
    });
  } catch (err) {
    // createNotification ya no lanza; esto cubre el fallo de las consultas de
    // arriba. Derivar tiene que funcionar aunque el aviso no salga.
    console.error(
      "[humanTakeover] no pude avisar de la derivacion:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
