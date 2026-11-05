import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { contactSearchFilter } from "@/lib/contacts/search";
import { RUNS_PAGE_SIZE, type FlowRunFilters, type RunState, type RunStepStatus } from "./runs";

/**
 * Las ejecuciones de una automatizacion. Se lee SIEMPRE con el cliente del usuario: la RLS (`can_see_flow_session`,
 * 00292) decide que ve cada quien. Columnas explicitas y nunca `select("*")`: `variables` no se puede leer con la sesion
 * y un `*` falla.
 */

type Db = SupabaseClient<Database>;

const RUN_COLUMNS =
  "id, contact_id, status, source_type, waiting_for_input, waiting_until, error_message, end_reason, has_failed_step, flow_version, created_at, finished_at";

export interface FlowRunRow {
  id: string;
  contact_id: string | null;
  status: string;
  source_type: string | null;
  waiting_for_input: boolean;
  waiting_until: string | null;
  error_message: string | null;
  end_reason: string | null;
  has_failed_step: boolean;
  flow_version: number | null;
  created_at: string;
  finished_at: string | null;
  contact: { id: string; display_name: string | null } | null;
}

export interface FlowRunStep {
  id: string;
  node_label: string;
  status: RunStepStatus;
  exit_label: string | null;
  reason: string | null;
  resumes_at: string | null;
  started_at: string;
  finished_at: string;
}

/** Los mismos cortes que `deriveRunState`, sobre las columnas. Si se cambia uno, se cambian los dos. */
function applyState(query: any, state: RunState): any {
  switch (state) {
    case "en_curso":
      return query.eq("status", "active").eq("waiting_for_input", false).is("waiting_until", null);
    case "esperando":
      return query.eq("status", "active").or("waiting_for_input.eq.true,waiting_until.not.is.null");
    case "termino":
      return query.eq("status", "completed").eq("has_failed_step", false);
    case "con_fallos":
      return query.eq("status", "completed").eq("has_failed_step", true);
    case "fallo":
      return query.eq("status", "cancelled").or("error_message.not.is.null,has_failed_step.eq.true");
    case "cancelada":
      return query.neq("status", "active").neq("status", "completed").is("error_message", null).eq("has_failed_step", false);
  }
}

export async function loadFlowRuns(
  supabase: Db,
  args: { flowId: string; filters: FlowRunFilters; dateRange: { from: string | null; to: string | null } },
): Promise<{ rows: FlowRunRow[]; total: number; error: boolean }> {
  const { flowId, filters, dateRange } = args;
  const search = filters.q ? contactSearchFilter(filters.q) : null;
  // Buscar por contacto deja afuera lo que no tiene contacto: `!inner` solo cuando hay busqueda.
  const contactJoin = search ? "contact:contacts!inner(id, display_name)" : "contact:contacts(id, display_name)";

  let query: any = supabase
    .from("flow_sessions")
    .select(`${RUN_COLUMNS}, ${contactJoin}`, { count: "exact" })
    .eq("flow_id", flowId);

  if (filters.estado) query = applyState(query, filters.estado);
  if (dateRange.from) query = query.gte("created_at", dateRange.from);
  if (dateRange.to) query = query.lte("created_at", dateRange.to);
  if (search) query = query.or(search, { referencedTable: "contact" });

  const from = (filters.page - 1) * RUNS_PAGE_SIZE;
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + RUNS_PAGE_SIZE - 1);

  if (error) {
    console.error(`[flows] no pude leer las ejecuciones (code=${error.code ?? "?"})`);
    return { rows: [], total: 0, error: true };
  }
  return { rows: (data ?? []) as FlowRunRow[], total: count ?? 0, error: false };
}

/** Una ejecucion con sus pasos. null si no existe, es de otro flujo o la persona no la puede ver. */
export async function loadFlowRunDetail(
  supabase: Db,
  args: { flowId: string; runId: string },
): Promise<{ run: FlowRunRow; steps: FlowRunStep[] } | null> {
  const { data: run, error } = await supabase
    .from("flow_sessions")
    .select(`${RUN_COLUMNS}, contact:contacts(id, display_name)`)
    .eq("flow_id", args.flowId)
    .eq("id", args.runId)
    .maybeSingle();
  if (error) {
    console.error(`[flows] no pude leer la ejecucion (code=${error.code ?? "?"})`);
    return null;
  }
  if (!run) return null;

  const { data: steps, error: stepsError } = await supabase
    .from("flow_session_steps")
    .select("id, node_label, status, exit_label, reason, resumes_at, started_at, finished_at")
    .eq("session_id", args.runId)
    .order("started_at", { ascending: true })
    .order("seq", { ascending: true })
    .limit(500);
  if (stepsError) console.error(`[flows] no pude leer los pasos de la ejecucion (code=${stepsError.code ?? "?"})`);

  return { run: run as unknown as FlowRunRow, steps: (steps ?? []) as FlowRunStep[] };
}
