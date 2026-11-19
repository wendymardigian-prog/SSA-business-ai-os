import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getPersonTool } from "@/lib/ai-tools/registry";
import { agentToolFields, agentToolPermission } from "./agent-tools";
import { executorOf } from "./core";
import type { ProposalScreenRow } from "./types";

/**
 * Lo que muestra la bandeja de aprobación: las pendientes que la persona VE (su sesión, la RLS decide) y las
 * últimas decididas. Los nombres de agentes y personas se leen con el servicio, solo para lo que ya se leyó.
 */

type Db = SupabaseClient<Database>;

const COLUMNS =
  "id, agent_id, requested_by, conversation_id, tool_key, label, summary, params_proposed, params_final, status, reject_reason, reject_note, error, decided_by, decided_at, created_at";

export interface ApprovalsScreen {
  pending: ProposalScreenRow[];
  decided: ProposalScreenRow[];
  pendingDrafts: number;
}

type Row = {
  id: string;
  agent_id: string | null;
  requested_by: string | null;
  conversation_id: string | null;
  tool_key: string;
  label: string;
  summary: string | null;
  params_proposed: unknown;
  params_final: unknown;
  status: string;
  reject_reason: string | null;
  reject_note: string | null;
  error: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export async function loadApprovalsScreen(args: {
  session: Db;
  service: Db;
  workspaceId: string;
  viewerId: string;
  can: (key: string) => boolean;
  memberNames: Map<string, string>;
}): Promise<ApprovalsScreen> {
  const [pendingRes, decidedRes, draftsRes] = await Promise.all([
    args.session.from("ai_proposals").select(COLUMNS).eq("workspace_id", args.workspaceId).eq("status", "pending").order("created_at", { ascending: true }).limit(50),
    args.session.from("ai_proposals").select(COLUMNS).eq("workspace_id", args.workspaceId).neq("status", "pending").order("decided_at", { ascending: false, nullsFirst: false }).limit(20),
    args.session.from("agent_drafts").select("id", { count: "exact", head: true }).eq("workspace_id", args.workspaceId).eq("status", "pending"),
  ]);
  if (pendingRes.error) console.error("[aprobaciones] no pude leer las pendientes:", pendingRes.error.message);
  const rows = [...((pendingRes.data ?? []) as unknown as Row[]), ...((decidedRes.data ?? []) as unknown as Row[])];
  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter((id): id is string => Boolean(id)))];
  const { data: agents } = agentIds.length
    ? await args.service.from("agents").select("id, name").in("id", agentIds).eq("workspace_id", args.workspaceId)
    : { data: [] as Array<{ id: string; name: string }> };
  const agentName = new Map((agents ?? []).map((a) => [a.id, a.name]));

  const toScreen = (r: Row): ProposalScreenRow => {
    const params = (r.params_proposed && typeof r.params_proposed === "object" ? r.params_proposed : {}) as Record<string, unknown>;
    // Para saber el ejecutor hace falta tool_config, que no viaja a la sesión: se deduce de requested_by.
    const executor = r.requested_by ? "person_tool" : "agent_tool";
    const personTool = executor === "person_tool" ? getPersonTool(r.tool_key) : null;
    const permission = personTool ? personTool.permission : agentToolPermission(r.tool_key);
    const canDecide = r.status === "pending" && args.can(permission) && (executor !== "person_tool" || r.requested_by === args.viewerId);
    return {
      id: r.id,
      agentName: r.agent_id ? agentName.get(r.agent_id) ?? "Agente" : null,
      label: r.label,
      summary: r.summary,
      toolKey: r.tool_key,
      executor,
      status: r.status,
      params,
      paramsFinal: (r.params_final as Record<string, unknown> | null) ?? null,
      fields: personTool ? personTool.fields : agentToolFields(params),
      rejectReason: r.reject_reason,
      rejectNote: r.reject_note,
      error: r.error,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      decidedByName: r.decided_by ? args.memberNames.get(r.decided_by) ?? "Alguien del equipo" : null,
      requestedByName: r.requested_by ? args.memberNames.get(r.requested_by) ?? "Alguien del equipo" : null,
      conversationId: r.conversation_id,
      permission,
      canDecide,
    };
  };

  return {
    pending: ((pendingRes.data ?? []) as unknown as Row[]).map(toScreen),
    decided: ((decidedRes.data ?? []) as unknown as Row[]).map(toScreen),
    pendingDrafts: draftsRes.count ?? 0,
  };
}

export { executorOf };
