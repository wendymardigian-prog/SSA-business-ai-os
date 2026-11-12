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
import { parseCapiConfig, META_CAPI_PROVIDER_ID } from "@/lib/meta/capi/config";
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
  const [email, ai, channels, agents, metaCapi, slack] = await Promise.all([
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
    // La API de Conversiones de Meta (00328): la integracion activa y con el Pixel. El token lo exige el guardado.
    safely(
      "la API de Conversiones",
      async () => {
        const { data, error } = await service
          .from("integration_configs")
          .select("is_active, config")
          .eq("workspace_id", workspaceId)
          .eq("type", "meta")
          .eq("provider", META_CAPI_PROVIDER_ID)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return parseCapiConfig(data) !== null;
      },
      ALL_CONNECTED.meta_capi,
    ),
    // Slack (Servicios A4, F158): la integración activa (el token lo prueba el guardado).
    safely(
      "Slack",
      async () => {
        const { data, error } = await service.from("integration_configs").select("is_active").eq("workspace_id", workspaceId).eq("type", "slack" as never).eq("provider", "slack").maybeSingle();
        if (error) throw new Error(error.message);
        return (data as { is_active?: boolean } | null)?.is_active === true;
      },
      ALL_CONNECTED.slack,
    ),
  ]);

  return { email, whatsapp_channel: channels.whatsapp, ai, agent: agents, channel: channels.any, meta_capi: metaCapi, slack };
}
