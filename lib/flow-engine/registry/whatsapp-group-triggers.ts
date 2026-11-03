/**
 * Los tres disparadores de grupos de WhatsApp en el registro (00282): alguien se unio, reacciono o voto.
 *
 * Son de CONTACTO: el evento lo emite el receptor de Evolution solo cuando la persona es (o quedo) contacto. Las
 * reglas viven puras en `lib/whatsapp-groups/automation/`. Dos cosas propias:
 *   - el flujo responde por el chat PRIVADO en el mismo numero del grupo (`conversationFor`), y si no hay
 *     conversacion se crea una sin no leidos;
 *   - un contacto con «no contactar» no arranca nada (el camino de eventos no lo miraba).
 */
import { registerTrigger } from "./registry";
import { GROUP_TRIGGER_TYPES, type GroupTriggerType } from "@/lib/whatsapp-groups/automation/payload";
import { groupDedupeKey, groupEventMatches } from "@/lib/whatsapp-groups/automation/trigger-config";
import { groupVariableFields, groupVariables } from "@/lib/whatsapp-groups/automation/variables";

const LABELS: Record<GroupTriggerType, string> = {
  whatsapp_group_joined: "Se unió a un grupo de WhatsApp",
  whatsapp_group_reaction: "Reaccionó a un mensaje de un grupo",
  whatsapp_group_poll_vote: "Votó en una encuesta de un grupo",
};

for (const type of GROUP_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: LABELS[type],
    scope: "event",
    // Debajo de `crm_event` (50), como los demas de eventos.
    priority: 45,
    sourceType: "contact",
    eventTypes: [type],

    eventMatches: async (args) => {
      if (!groupEventMatches(type, args.config, args.event.payload)) return false;
      if (!args.event.contact_id) return false;
      try {
        const { data } = await args.supabase.from("contacts").select("do_not_contact").eq("id", args.event.contact_id).maybeSingle();
        return !(data as { do_not_contact?: boolean } | null)?.do_not_contact;
      } catch {
        // Ante la duda, no se le escribe.
        return false;
      }
    },

    dedupeKeyFor: (args) => groupDedupeKey(type, args.config, args.event.payload, args.event.contact_id ?? "", args.event.id),

    conversationFor: async (args) => {
      const channelId = typeof args.event.payload?.channel_id === "string" ? args.event.payload.channel_id : null;
      if (!channelId || !args.event.contact_id) return null;
      try {
        const { data: channel } = await args.supabase
          .from("channels")
          .select("id, workspace_id, platform")
          .eq("id", channelId)
          .eq("workspace_id", args.event.workspace_id)
          .maybeSingle();
        if (!channel) return null;
        const { data: existing } = await args.supabase
          .from("conversations")
          .select("id, channel_id")
          .eq("channel_id", channelId)
          .eq("contact_id", args.event.contact_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (existing) return existing;
        // Import diferido: `lib/inbound` importa el motor, que importa este registro.
        const { upsertConversation } = await import("@/lib/inbound");
        const created = await upsertConversation({
          supabase: args.supabase,
          channel,
          contactId: args.event.contact_id,
          preview: "",
          at: new Date().toISOString(),
          incrementUnread: false,
        });
        return created ? { id: created.id, channel_id: channelId } : null;
      } catch (error) {
        console.error("[grupos] no pude preparar la conversacion privada:", error instanceof Error ? error.message : "error");
        return null;
      }
    },

    variableSchema: () => groupVariableFields(type).map((f) => ({ path: f.path, label: f.label, type: "text" as const, group: "Del grupo" })),

    variablesFor: (args) => groupVariables(type, (args.event.payload ?? {}) as Record<string, unknown>),
  });
}
