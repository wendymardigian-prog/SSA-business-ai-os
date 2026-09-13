import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { IncomingMessage } from "./types";
import { getTrigger, listTriggerGuards, listTriggers } from "./registry";
import type { TriggerRow } from "./registry/types";

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

/**
 * Elige que trigger le corresponde a un mensaje entrante.
 *
 * El orden entre tipos lo declara cada trigger en el registro con su prioridad,
 * no una cascada de `if` escrita aca: eso era lo que obligaba a abrir este
 * archivo cada vez que se sumaba un tipo. Adentro de un mismo tipo manda la
 * columna `priority` de la fila, que es lo que ordena la consulta.
 *
 * Un trigger sin `matches` (el de respuesta por defecto) matchea siempre que se
 * llegue hasta el, que es justamente para lo que existe.
 */
export async function matchTrigger(
  supabase: SupabaseClient<Database>,
  {
    channelId,
    workspaceId,
    conversationId,
    message,
    isFirstMessage,
  }: {
    channelId: string;
    workspaceId: string;
    conversationId: string;
    message: IncomingMessage;
    /** El llamador ya sabe si es el primer mensaje (los dos receptores lo
     * pasan, mirando si el contacto existia), asi que la consulta de respaldo
     * de abajo no corre en produccion. Desde la Fase 3 los entrantes SI se
     * guardan, asi que ese respaldo por fin devuelve algo real — pero sigue
     * siendo el respaldo: preguntarle al contacto es una consulta menos. */
    isFirstMessage?: boolean;
  }
): Promise<Trigger | null> {
  // Un trigger con channel_id null vale para todo el workspace, NO para todos:
  // el join con flows tiene que quedar clavado al workspace del canal o los
  // triggers de un negocio correrian sobre el canal de otro.
  const { data: triggers } = await supabase
    .from("triggers")
    .select("*, flows!inner(status, workspace_id)")
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", workspaceId)
    .order("priority", { ascending: false });

  if (!triggers || triggers.length === 0) return null;

  const text = message.text?.toLowerCase().trim() ?? "";
  const firstMessage = await resolveIsFirstMessage(
    supabase,
    conversationId,
    isFirstMessage
  );

  for (const definition of listTriggers("message")) {
    for (const trigger of triggers.filter((t) => t.type === definition.type)) {
      const config = (trigger.config ?? {}) as Record<string, unknown>;
      const matched = definition.matches
        ? definition.matches({
            trigger: trigger as unknown as TriggerRow,
            config,
            message,
            text,
            isFirstMessage: firstMessage,
          })
        : true;

      if (!matched) continue;

      const guardArgs = {
        supabase,
        trigger: trigger as unknown as TriggerRow,
        workspaceId,
        contactId: "",
        conversationId,
      };

      // Puerta propia del tipo, si la declara.
      if (definition.guard && !(await definition.guard(guardArgs))) continue;

      // Puertas que se prenden desde la config (Fase 3). Van tambien para el
      // trigger por defecto: antes se devolvia antes de llegar aca, y ninguna
      // puerta podia aplicarse justo al trigger que captura todo.
      let blocked = false;
      for (const guard of listTriggerGuards()) {
        if (config[guard.configKey] === true && !(await guard.allows(guardArgs))) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      return trigger;
    }
  }

  return null;
}

async function resolveIsFirstMessage(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  known: boolean | undefined
): Promise<boolean> {
  if (known !== undefined) return known;

  const { count } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound");

  return count === 1;
}

/** Re-export para quien necesite mirar una definicion puntual. */
export { getTrigger };
