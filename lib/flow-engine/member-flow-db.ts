/**
 * `memberFlowProblems` con la base: sabe de qué se trata cada flujo al que apunta un
 * "Ir a otro flujo". Solo servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { flowSubject, memberFlowProblems } from "./member-flow";

export async function checkMemberFlow(db: SupabaseClient<Database>, workspaceId: string, nodes: unknown[]): Promise<string[]> {
  if (flowSubject(nodes) !== "member") return [];
  const targets = (nodes as Array<{ data?: { actionType?: unknown; flowId?: unknown }; type?: string }>)
    .filter((n) => n?.type === "goToFlow" || n?.data?.actionType === "goToFlow")
    .map((n) => n.data?.flowId)
    .filter((id): id is string => typeof id === "string");
  const subjects = new Map<string, "contact" | "member">();
  if (targets.length > 0) {
    const { data } = await db.from("flows").select("id, nodes").eq("workspace_id", workspaceId).in("id", targets);
    for (const flow of data ?? []) subjects.set(flow.id, flowSubject(Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : []));
  }
  return memberFlowProblems(nodes, (id) => subjects.get(id));
}
