/**
 * Los pasos de un flujo que no se pueden ejecutar por una conexion que falta
 * (Resend, WhatsApp, una IA...), listos para decirselo a quien lo quiere
 * PUBLICAR o PRENDER (G1.4).
 *
 * Una sola funcion para todos los caminos que prenden un flujo (publicar desde
 * el lienzo, prender el de un formulario, el de una agenda): asi nadie publica
 * por una puerta lateral lo que otra puerta frena. Un borrador siempre se puede
 * guardar; esto solo se mira al prender.
 *
 * Sin pasos con requisitos ni siquiera se consulta la base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadAutomationCapabilities } from "./capabilities";
import { blockedNodes, requirementProblems, requirementsOfNode, type GraphEdgeLike, type GraphNodeLike } from "./node-requirements";

export async function connectionProblemsForGraph(
  getServiceClient: () => Promise<SupabaseClient<Database>>,
  workspaceId: string,
  nodes: unknown[],
  edges: unknown[],
): Promise<string[]> {
  const graph = nodes as GraphNodeLike[];
  if (!graph.some((n) => requirementsOfNode(n).length > 0)) return [];
  const capabilities = await loadAutomationCapabilities(await getServiceClient(), workspaceId);
  return requirementProblems(blockedNodes(graph, edges as GraphEdgeLike[], capabilities));
}
