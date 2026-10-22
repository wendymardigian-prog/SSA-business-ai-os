import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { AgentRunSource, Database } from "@/lib/types/database";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { agentsPageMode } from "@/lib/agent/page-mode";

/**
 * Si el negocio uso IA alguna vez, contado desde `agent_runs`.
 *
 * Se consulta con el cliente de SERVICIO: un Member solo ve las corridas de sus
 * conversaciones (RLS de la 00060) y contestaria "nunca" cuando si hubo. Lo que
 * devuelven estas funciones decide que se dibuja, no muestra ninguna corrida.
 *
 * Ante un error se responde `true`: es la respuesta que no esconde nada (la
 * pantalla completa con su aviso), no un empty state que mienta.
 *
 * Las dos usan el indice `(workspace_id, source, created_at)` de la 00251.
 */

type Service = SupabaseClient<Database>;

async function anyRun(service: Service, workspaceId: string, source: AgentRunSource | null): Promise<boolean> {
  let query = service.from("agent_runs").select("id").eq("workspace_id", workspaceId);
  if (source) query = query.eq("source", source);
  const { data, error } = await query.limit(1);
  if (error) {
    console.error("[agent-usage] no pude leer agent_runs:", error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/** Hubo alguna corrida de IA (cualquier agente o tarea). Decide el empty state de Agentes IA. */
export function workspaceEverUsedAi(service: Service, workspaceId: string): Promise<boolean> {
  return anyRun(service, workspaceId, null);
}

/** El agente de chat actuo alguna vez en una conversacion. Decide la seccion "El agente" del dashboard de Chat. */
export function chatAgentEverActed(service: Service, workspaceId: string): Promise<boolean> {
  return anyRun(service, workspaceId, "agent");
}

/**
 * El modo de la pantalla de Agentes IA (lib/agent/page-mode.ts) con sus dos
 * datos. El historial se mira solo si no hay IA: con una conectada no hace falta.
 */
export async function loadAgentsPageMode(service: Service, workspaceId: string) {
  const providers = await listConnectedAiProviders(workspaceId, service);
  const everUsedAi = providers.length > 0 ? true : await workspaceEverUsedAi(service, workspaceId);
  return { providers, mode: agentsPageMode({ connectedProviders: providers.map((p) => p.provider), everUsedAi }) };
}

/** Las pantallas internas de Agentes IA (un agente, una tarea, las corridas) no existen en el empty state: vuelven a la lista. */
export async function redirectIfAgentsEmpty(service: Service, workspaceId: string): Promise<void> {
  const { mode } = await loadAgentsPageMode(service, workspaceId);
  if (mode === "empty") redirect("/dashboard/agents");
}
