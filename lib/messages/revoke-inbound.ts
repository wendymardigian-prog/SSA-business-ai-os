/**
 * Marca un mensaje de WhatsApp como borrado "para todos" (00356).
 *
 * La unica puerta es `mark_message_deleted_for_everyone` (solo service_role):
 * busca el mensaje por su id de WhatsApp dentro del canal y no pisa un borrado
 * anterior, asi que el mismo aviso dos veces (o el eco del boton de la app) no
 * cambia nada.
 *
 * Nunca lanza: un borrado que no se pudo marcar no puede tumbar un webhook ni
 * el boton de la bandeja (que ya borro en WhatsApp).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DeletedSource } from "@/lib/messages/revoke";

type Db = SupabaseClient<Database>;

export async function markMessageDeletedForEveryone(
  service: Db,
  args: {
    workspaceId: string;
    channelId: string;
    platformMessageId: string;
    source: DeletedSource;
    /** La persona, solo con source = app. */
    userId?: string | null;
    at?: string | null;
  },
): Promise<number> {
  try {
    const { data, error } = await service.rpc("mark_message_deleted_for_everyone", {
      p_workspace_id: args.workspaceId,
      p_channel_id: args.channelId,
      p_platform_message_id: args.platformMessageId,
      p_source: args.source,
      p_by: args.source === "app" ? (args.userId ?? null) : null,
      ...(args.at ? { p_at: args.at } : {}),
    });
    if (error) {
      console.error("[revoke] no pude marcar el mensaje como eliminado:", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("[revoke] no pude marcar el mensaje como eliminado:", err instanceof Error ? err.message : "error");
    return 0;
  }
}
