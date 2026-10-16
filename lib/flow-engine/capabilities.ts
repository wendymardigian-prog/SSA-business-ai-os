/**
 * Que conexiones tiene el negocio HOY, para decidir que acciones de una
 * automatizacion se pueden ejecutar (G1). Solo corre en el servidor.
 *
 * Se calcula al abrir la pantalla (y al publicar), NUNCA se guarda en el flujo:
 * por eso conectar un proveedor habilita sus acciones sin reconstruir nada, y
 * desconectarlo las vuelve a bloquear.
 *
 * Si una consulta falla, esa conexion se da por buena: un error de lectura no
 * puede bloquear una automatizacion que si podia correr. Lo que se pierde es solo
 * un aviso; nunca una publicacion (se lee de la base y se registra en el log).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { getAgentType } from "@/lib/agent/agent-types";
import { isEmailConfigured } from "@/lib/email/send";
import { ALL_CONNECTED, type Capabilities } from "./node-requirements";

type Db = SupabaseClient<Database>;

async function safely<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(`[capabilities] no pude leer ${label}:`, err instanceof Error ? err.message : "error");
    return fallback;
  }
}

/** Con el cliente de servicio: son lecturas de configuracion del negocio, ya autorizadas por quien llama. */
export async function loadAutomationCapabilities(service: Db, workspaceId: string): Promise<Capabilities> {
  const [email, ai, channels, agents] = await Promise.all([
    safely("el email", () => isEmailConfigured(service, workspaceId), ALL_CONNECTED.email),
    safely("las IAs", async () => (await listConnectedAiProviders(workspaceId, service)).length > 0, ALL_CONNECTED.ai),
    safely(
      "los canales",
      async () => {
        const { data, error } = await service
          .from("channels")
          .select("platform, provider, evolution_instance")
          .eq("workspace_id", workspaceId)
          .eq("is_active", true);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        return {
          any: rows.length > 0,
          whatsapp: rows.some((c) => c.platform === "whatsapp" && c.provider === "evolution" && !!c.evolution_instance),
        };
      },
      { any: ALL_CONNECTED.channel, whatsapp: ALL_CONNECTED.whatsapp_channel },
    ),
    safely(
      "los agentes",
      async () => {
        const { data, error } = await service.from("agents").select("type").eq("workspace_id", workspaceId).is("deleted_at", null);
        if (error) throw new Error(error.message);
        return (data ?? []).some((a) => getAgentType(a.type)?.conversational);
      },
      ALL_CONNECTED.agent,
    ),
  ]);

  return { email, whatsapp_channel: channels.whatsapp, ai, agent: agents, channel: channels.any };
}
