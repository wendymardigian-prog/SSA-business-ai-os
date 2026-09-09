import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";

/**
 * Marca o desmarca al contacto como suscripto.
 *
 * Es lo mismo que hacen las palabras clave globales del workspace (STOP/BAJA),
 * pero decidido por el flow.
 */
function build(type: "subscribe" | "unsubscribe", label: string): NodeDefinition<unknown> {
  return {
    type,
    label,
    aliases: [{ nodeType: "action", actionType: type }],
    async execute({ supabase, context }: NodeExecutionArgs<unknown>) {
      await supabase
        .from("contacts")
        .update({ is_subscribed: type === "subscribe" })
        .eq("id", context.contactId);
    },
  };
}

export const subscribeNode = build("subscribe", "Suscribir");
export const unsubscribeNode = build("unsubscribe", "Desuscribir");
