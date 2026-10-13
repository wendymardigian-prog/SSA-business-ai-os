/**
 * `memberFlowProblems` (flujos de una persona del equipo) y `webhookFlowProblems` (flujos de
 * webhook, que necesitan las aristas) con la base: sabe de qué se trata cada flujo al que
 * apunta un "Ir a otro flujo". Solo servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { flowSubject, memberFlowProblems, webhookFlowProblems } from "./member-flow";

export async function checkMemberFlow(db: SupabaseClient<Database>, workspaceId: string, nodes: unknown[], edges: unknown[] = [], options: { publishing?: boolean } = {}): Promise<string[]> {
  const subject = flowSubject(nodes);
  if (subject === "contact") return [];
  // Un flujo de webhook se puede GUARDAR a medias (el paso de contacto todavia no esta puesto): la regla
  // frena la PUBLICACION, que es cuando importa. Los de persona del equipo se rechazan ya al guardar.
  if (subject === "webhook" && !options.publishing) return [];
  const targets = (nodes as Array<{ data?: { actionType?: unknown; flowId?: unknown }; type?: string }>)
    .filter((n) => n?.type === "goToFlow" || n?.data?.actionType === "goToFlow")
    .map((n) => n.data?.flowId)
    .filter((id): id is string => typeof id === "string");
  const subjects = new Map<string, "contact" | "member" | "webhook">();
  if (targets.length > 0) {
    const { data } = await db.from("flows").select("id, nodes").eq("workspace_id", workspaceId).in("id", targets);
    for (const flow of data ?? []) subjects.set(flow.id, flowSubject(Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : []));
  }
  // Un flujo de webhook puede tener pasos con contacto, pero solo despues de «Crear o actualizar contacto».
  if (subject === "webhook") return webhookFlowProblems(nodes, edges, (id) => subjects.get(id));
  return memberFlowProblems(nodes, (id) => subjects.get(id));
}
