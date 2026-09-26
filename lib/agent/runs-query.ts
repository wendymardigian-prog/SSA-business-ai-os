import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunStatus, Database, Json } from "@/lib/types/database";
import { DATE_PRESETS, resolveDateRange, type DatePreset } from "@/lib/dates";
import { firstParam, pickEnum, pickPage, sanitizeSearch, type SearchParams } from "@/lib/url-params";
import { AGENT_RUN_PUBLIC_COLUMNS } from "./public";
import { RUN_STATUS_LABELS } from "./run-labels";
import type { RunFilters, RunRow, RunStepRow } from "./screen";

/**
 * La pestana Runs (F28): filtros que viven en la URL y la consulta que los
 * traduce. Mismo patron que la bandeja y el CRM (lib/url-params, lib/dates):
 * lo que viene de la URL se valida contra lo que el servidor ya sabe que
 * existe, y un valor inventado se ignora en vez de romper la consulta.
 *
 * Dos clientes segun el rol:
 *   - Owner/Admin: service role, con las columnas de costo (00060 no las deja
 *     leer con el cliente de usuario, ni siquiera a un Admin).
 *   - Member: su propio cliente, con AGENT_RUN_PUBLIC_COLUMNS. La RLS le deja
 *     ver solo los runs de conversaciones de su scope, y sin costo.
 */

type Db = SupabaseClient<Database>;

export const RUNS_PAGE_SIZE = 25;
export const AGENT_FILTER_ALL = "todos";
export const AGENT_FILTER_NONE = "sin-agente";

const STATUS_VALUES = Object.keys(RUN_STATUS_LABELS);

export function parseRunFilters(
  params: SearchParams,
  known: { currentAgentId: string; agentIds: string[]; channelIds: string[]; toolNames: string[]; models: string[]; allowCost: boolean },
): RunFilters {
  const agenteRaw = firstParam(params.agente);
  const agente =
    agenteRaw === AGENT_FILTER_ALL || agenteRaw === AGENT_FILTER_NONE
      ? agenteRaw
      : known.agentIds.includes(agenteRaw)
        ? agenteRaw
        : known.currentAgentId;
  const canal = pickEnum(params.canal, known.channelIds);
  const num = (v: string): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    page: pickPage(params.page),
    datePreset: pickEnum<DatePreset>(params.fecha, DATE_PRESETS),
    dateFrom: firstParam(params.desde),
    dateTo: firstParam(params.hasta),
    agente,
    canal,
    contacto: /^[0-9a-f-]{36}$/i.test(firstParam(params.contacto)) ? firstParam(params.contacto) : "",
    conversacion: /^[0-9a-f-]{36}$/i.test(firstParam(params.c)) ? firstParam(params.c) : "",
    q: sanitizeSearch(firstParam(params.q)),
    resultado: pickEnum(params.resultado, STATUS_VALUES),
    modelo: pickEnum(params.modelo, known.models),
    accion: pickEnum(params.accion, known.toolNames),
    costoMin: known.allowCost ? num(firstParam(params.costo_min)) : null,
    costoMax: known.allowCost ? num(firstParam(params.costo_max)) : null,
  };
}

export function countActiveRunFilters(f: RunFilters, currentAgentId: string): number {
  let n = 0;
  if (f.datePreset) n++;
  if (f.agente !== currentAgentId) n++;
  if (f.canal) n++;
  if (f.contacto || f.conversacion || f.q) n++;
  if (f.resultado) n++;
  if (f.modelo) n++;
  if (f.accion) n++;
  if (f.costoMin !== null || f.costoMax !== null) n++;
  return n;
}

const COST_COLUMNS = "input_tokens, output_tokens, cached_tokens, embedding_tokens, cost_usd";

interface RawRun {
  id: string;
  source: string;
  agent_id: string | null;
  prompt_version: number | null;
  conversation_id: string | null;
  contact_id: string | null;
  channel_id: string | null;
  trigger: string;
  status: string;
  status_detail: string | null;
  routing: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  step_count: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  embedding_tokens?: number | null;
  cost_usd?: number | string | null;
  contacts?: { display_name: string | null } | { display_name: string | null }[] | null;
}

export async function loadRuns(
  client: Db,
  args: {
    workspaceId: string;
    filters: RunFilters;
    includeCost: boolean;
    agentNames: Map<string, string>;
    channelLabels: Map<string, string>;
    timeZone?: string;
  },
): Promise<{ rows: RunRow[]; total: number }> {
  const f = args.filters;
  const cols = args.includeCost ? `${AGENT_RUN_PUBLIC_COLUMNS}, ${COST_COLUMNS}` : AGENT_RUN_PUBLIC_COLUMNS;
  const contactJoin = f.q ? "contacts!inner(display_name)" : "contacts(display_name)";
  const stepJoin = f.accion ? ", agent_run_steps!inner(name, kind)" : "";

  let query = client
    .from("agent_runs")
    .select(`${cols}, ${contactJoin}${stepJoin}`, { count: "exact" })
    .eq("workspace_id", args.workspaceId);

  if (f.agente === AGENT_FILTER_NONE) query = query.is("agent_id", null);
  else if (f.agente !== AGENT_FILTER_ALL) query = query.eq("agent_id", f.agente);
  if (f.canal) query = query.eq("channel_id", f.canal);
  if (f.contacto) query = query.eq("contact_id", f.contacto);
  if (f.conversacion) query = query.eq("conversation_id", f.conversacion);
  if (f.q) query = query.ilike("contacts.display_name", `%${f.q}%`);
  if (f.resultado) query = query.eq("status", f.resultado as AgentRunStatus);
  if (f.modelo) query = query.eq("model", f.modelo);
  if (f.accion) query = query.eq("agent_run_steps.kind", "tool_call").eq("agent_run_steps.name", f.accion);
  if (args.includeCost && f.costoMin !== null) query = query.gte("cost_usd", f.costoMin);
  if (args.includeCost && f.costoMax !== null) query = query.lte("cost_usd", f.costoMax);

  const range = resolveDateRange(f.datePreset, f.dateFrom, f.dateTo, new Date(), args.timeZone);
  if (range.from) query = query.gte("created_at", range.from);
  if (range.to) query = query.lte("created_at", range.to);

  const from = (f.page - 1) * RUNS_PAGE_SIZE;
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + RUNS_PAGE_SIZE - 1);
  if (error) {
    console.error("[runs] no pude leer los runs:", error.message);
    return { rows: [], total: 0 };
  }

  const raw = (data ?? []) as unknown as RawRun[];
  const steps = await loadSteps(client, raw.map((r) => r.id));

  const rows: RunRow[] = raw.map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return {
      id: r.id,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      source: r.source,
      trigger: r.trigger,
      status: r.status,
      statusDetail: r.status_detail,
      routing: (r.routing ?? null) as Record<string, unknown> | null,
      agentId: r.agent_id,
      agentName: r.agent_id ? args.agentNames.get(r.agent_id) ?? null : null,
      promptVersion: r.prompt_version,
      conversationId: r.conversation_id,
      contactId: r.contact_id,
      contactName: contact?.display_name ?? null,
      channelId: r.channel_id,
      channelLabel: r.channel_id ? args.channelLabels.get(r.channel_id) ?? null : null,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latency_ms,
      stepCount: r.step_count,
      error: r.error,
      cost: args.includeCost
        ? {
            usd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
            inputTokens: r.input_tokens ?? null,
            outputTokens: r.output_tokens ?? null,
            cachedTokens: r.cached_tokens ?? null,
            embeddingTokens: r.embedding_tokens ?? null,
          }
        : null,
      steps: steps.get(r.id) ?? [],
    };
  });

  return { rows, total: count ?? rows.length };
}

async function loadSteps(client: Db, runIds: string[]): Promise<Map<string, RunStepRow[]>> {
  const byRun = new Map<string, RunStepRow[]>();
  if (runIds.length === 0) return byRun;

  const { data: steps, error } = await client
    .from("agent_run_steps")
    .select("id, run_id, step_index, kind, name, input, output, kb_chunk_ids, audit_log_id, duration_ms, error")
    .in("run_id", runIds)
    .order("step_index", { ascending: true });
  if (error) {
    console.error("[runs] no pude leer los pasos:", error.message);
    return byRun;
  }

  // Titulos de los fragmentos de KB, en una sola consulta. Si el rol no puede
  // leerlos (la KB es de Owner/Admin), se muestra la cantidad y nada mas.
  const chunkIds = [...new Set((steps ?? []).flatMap((s) => s.kb_chunk_ids ?? []))];
  const chunkLabels = new Map<string, string>();
  if (chunkIds.length > 0) {
    const { data: chunks } = await client
      .from("knowledge_chunks")
      .select("id, chunk_index, knowledge_base(title)")
      .in("id", chunkIds);
    for (const c of (chunks ?? []) as Array<{ id: string; chunk_index: number; knowledge_base: { title: string } | { title: string }[] | null }>) {
      const doc = Array.isArray(c.knowledge_base) ? c.knowledge_base[0] : c.knowledge_base;
      chunkLabels.set(c.id, `${doc?.title ?? "Documento"} · fragmento ${c.chunk_index + 1}`);
    }
  }

  for (const s of steps ?? []) {
    const list = byRun.get(s.run_id) ?? [];
    list.push({
      id: s.id,
      index: s.step_index,
      kind: s.kind,
      name: s.name,
      input: (s.input ?? null) as Json | null,
      output: (s.output ?? null) as Json | null,
      kbChunks: (s.kb_chunk_ids ?? []).map((id) => ({ id, label: chunkLabels.get(id) ?? null })),
      auditLogId: s.audit_log_id,
      durationMs: s.duration_ms,
      error: s.error,
    });
    byRun.set(s.run_id, list);
  }
  return byRun;
}
