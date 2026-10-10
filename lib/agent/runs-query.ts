import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunSource, AgentRunStatus, Database, Json } from "@/lib/types/database";
import { DATE_PRESETS, type DatePreset } from "@/lib/dates";
import { firstParam, pickEnum, pickPage, sanitizeSearch, type SearchParams } from "@/lib/url-params";
import { AGENT_RUN_PUBLIC_COLUMNS } from "./public";
import { RUN_STATUS_LABELS } from "./run-labels";
import { RUN_ORDERS, type RunFilters, type RunOrder, type RunRow, type RunStepRow } from "./screen";
import { countNewRunFilters, isRunDetailFilter, pickRuleFilter, runDetailQuery } from "./runs-filters";
import { AI_TASKS } from "@/lib/ai-tasks/catalog";

/**
 * "Clasificación al cierre" (Bloque Agentes IA) no tiene `source` propio: es
 * el mismo run de `conversation_summary` con `status_detail` que incluye
 * "classified". El filtro de Origen la ofrece como un valor mas, y acá se
 * traduce a las dos condiciones reales.
 */
const CLOSE_CLASSIFICATION = AI_TASKS.close_classification;

/**
 * La pestana Runs de un agente (F28) Y la pantalla global de Corridas
 * (Bloque R, R1): mismos filtros, misma consulta. Filtros que viven en la
 * URL y la consulta que los traduce, igual que la bandeja y el CRM
 * (lib/url-params, lib/dates): lo que viene de la URL se valida contra lo
 * que el servidor ya sabe que existe, y un valor inventado se ignora en vez
 * de romper la consulta.
 *
 * `currentAgentId` es `null` en la pantalla global (ningun agente es "el de
 * la pestaña"): ahi el filtro de agente por defecto es `AGENT_FILTER_ALL`, y
 * CUALQUIER agente puesto a mano cuenta como filtro activo.
 *
 * El rango de fechas ya NO lo resuelve esta funcion: `loadRuns` recibe un
 * `dateRange` ya resuelto (D6), para que sirva tanto al `DatePreset` de
 * `DateFilter` (la pestaña del agente) como al `PeriodPreset` de
 * `PeriodPopover` (Corridas), sin que este modulo conozca ninguno de los dos.
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
  known: {
    /** null en la pantalla global de Corridas: no hay "el agente de la pestaña". */
    currentAgentId: string | null;
    agentIds: string[];
    channelIds: string[];
    toolNames: string[];
    models: string[];
    allowCost: boolean;
    /** Los ids de las reglas que existen hoy, para validar el filtro (§15.4). */
    ruleIds?: string[];
    /** Los `source` con al menos una corrida en el periodo (R1: desde los datos, no del CHECK). */
    sources?: string[];
    /** La pestaña Runs de una tarea (Bloque Agentes IA): ese es "el origen de la pestaña". null en el resto. */
    currentOrigen?: string | null;
  },
): RunFilters {
  const agenteRaw = firstParam(params.agente);
  const defaultAgente = known.currentAgentId ?? AGENT_FILTER_ALL;
  const agente =
    agenteRaw === AGENT_FILTER_ALL || agenteRaw === AGENT_FILTER_NONE
      ? agenteRaw
      : known.agentIds.includes(agenteRaw)
        ? agenteRaw
        : defaultAgente;
  const canal = pickEnum(params.canal, known.channelIds);
  const origenOptions = [...(known.sources ?? []), CLOSE_CLASSIFICATION.id];
  const origenRaw = firstParam(params.origen);
  const origen = origenRaw ? pickEnum(params.origen, origenOptions) || (known.currentOrigen ?? "") : (known.currentOrigen ?? "");
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
    regla: pickRuleFilter(firstParam(params.regla), known.ruleIds ?? []),
    detalle: isRunDetailFilter(firstParam(params.detalle)) ? firstParam(params.detalle) : "",
    costoMin: known.allowCost ? num(firstParam(params.costo_min)) : null,
    costoMax: known.allowCost ? num(firstParam(params.costo_max)) : null,
    origen,
    sinPrecio: known.allowCost && firstParam(params.sin_precio) === "1",
    masLentas: firstParam(params.lentas) === "1",
    orden: pickOrden(params, known.allowCost),
  };
}

/**
 * `orden` nuevo, o el atajo viejo `caras=1` si no vino ninguno (compatibilidad
 * con los links guardados de antes de este Bloque). "caras"/"baratas" solo
 * valen con permiso de costo.
 */
function pickOrden(params: SearchParams, allowCost: boolean): RunOrder {
  const raw = firstParam(params.orden);
  if ((RUN_ORDERS as readonly string[]).includes(raw)) {
    const orden = raw as RunOrder;
    if ((orden === "caras" || orden === "baratas") && !allowCost) return "recientes";
    return orden;
  }
  if (allowCost && firstParam(params.caras) === "1") return "caras";
  return "recientes";
}

/** `currentAgentId` null (Corridas): el agente puesto a mano siempre cuenta, no hay "el de la pestaña". */
export function countActiveRunFilters(f: RunFilters, currentAgentId: string | null, currentOrigen: string | null = null): number {
  let n = 0;
  if (f.datePreset) n++;
  if (f.agente !== (currentAgentId ?? AGENT_FILTER_ALL)) n++;
  if (f.canal) n++;
  if (f.contacto || f.conversacion || f.q) n++;
  if (f.resultado) n++;
  if (f.modelo) n++;
  if (f.accion) n++;
  if (f.origen !== (currentOrigen ?? "")) n++;
  n += countNewRunFilters(f.detalle, f.regla);
  if (f.costoMin !== null || f.costoMax !== null) n++;
  if (f.sinPrecio) n++;
  if (f.masLentas) n++;
  if (f.orden !== "recientes") n++;
  return n;
}

/**
 * El filtro de Origen admite el pseudo-valor "close_classification" (no es un
 * `agent_runs.source` real): se traduce a `source = conversation_summary` más
 * `status_detail LIKE '%classified%'`. Cualquier otro valor es un `source` de
 * verdad y se filtra por igualdad, como siempre.
 */
export function applyOrigenFilter<Q extends { eq: (...a: any[]) => Q; like: (...a: any[]) => Q }>(query: Q, origen: string): Q {
  if (origen === CLOSE_CLASSIFICATION.id) {
    return query.eq("source", CLOSE_CLASSIFICATION.source).like("status_detail", CLOSE_CLASSIFICATION.detailLike as string);
  }
  return query.eq("source", origen as AgentRunSource);
}

/** La columna y el sentido del `ORDER BY`, segun `orden` (Bloque Agentes IA). "caras"/"baratas" sin permiso de costo caen a "recientes". */
export function orderColumn(orden: RunOrder | undefined, includeCost: boolean): { col: "created_at" | "cost_usd" | "latency_ms"; ascending: boolean } {
  switch (orden) {
    case "antiguas":
      return { col: "created_at", ascending: true };
    case "caras":
      return includeCost ? { col: "cost_usd", ascending: false } : { col: "created_at", ascending: false };
    case "baratas":
      return includeCost ? { col: "cost_usd", ascending: true } : { col: "created_at", ascending: false };
    case "lentas":
      return { col: "latency_ms", ascending: false };
    case "rapidas":
      return { col: "latency_ms", ascending: true };
    default:
      return { col: "created_at", ascending: false };
  }
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
  thread_id: string | null;
  status: string;
  status_detail: string | null;
  routing: Record<string, unknown> | null;
  intent: Record<string, unknown> | null;
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

/**
 * Los `source` con al menos una corrida en el rango (R1): desde los datos,
 * nunca de la lista de valores del CHECK. `message_classification_eval` esta
 * en el CHECK y nadie lo escribe (docs/PENDIENTE.md); listarla igual seria un
 * filtro que nunca devuelve nada.
 */
export async function loadActiveSources(client: Db, args: { workspaceId: string; dateRange: { from: string | null; to: string | null } }): Promise<string[]> {
  let query = client.from("agent_runs").select("source").eq("workspace_id", args.workspaceId).neq("status", "running");
  if (args.dateRange.from) query = query.gte("created_at", args.dateRange.from);
  if (args.dateRange.to) query = query.lte("created_at", args.dateRange.to);
  const { data, error } = await query.limit(5000);
  if (error) {
    console.error("[runs] no pude leer los origenes del periodo:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.source))].sort();
}

export async function loadRuns(
  client: Db,
  args: {
    workspaceId: string;
    filters: RunFilters;
    includeCost: boolean;
    agentNames: Map<string, string>;
    channelLabels: Map<string, string>;
    /**
     * Ya resuelto por quien llama (D6): la pestaña del agente lo resuelve con
     * `resolveDateRange` (DatePreset); Corridas, con `resolvePeriod`
     * (PeriodPreset). Esta funcion no conoce ninguno de los dos vocabularios.
     */
    dateRange: { from: string | null; to: string | null };
    /** Para el export a CSV (R3): mas filas que una pagina, en una sola pasada. */
    pageSize?: number;
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
  if (f.origen) query = applyOrigenFilter(query, f.origen);
  if (f.accion) query = query.eq("agent_run_steps.kind", "tool_call").eq("agent_run_steps.name", f.accion);

  // Regla y detalle (§15.4). El detalle se busca con `like`: `status_detail`
  // lleva varias notas separadas por coma ("rule:r3, outside_hours") y un `eq`
  // no encontraria nada en cuanto el turno tenga dos.
  const detail = runDetailQuery(f.detalle, f.regla);
  if (detail.statusDetailLike) query = query.like("status_detail", detail.statusDetailLike);
  if (detail.routingRuleId) query = query.eq("routing->>rule_id", detail.routingRuleId);
  if (detail.routingRuleIsNull) query = query.eq("routing->>mode", "rules").is("routing->>rule_id", null);
  if (args.includeCost && f.costoMin !== null) query = query.gte("cost_usd", f.costoMin);
  if (args.includeCost && f.costoMax !== null) query = query.lte("cost_usd", f.costoMax);
  // Atajos (R2). "Sin precio": cost_usd NULL con algun token que costee algo.
  if (args.includeCost && f.sinPrecio) query = query.is("cost_usd", null).or("input_tokens.gt.0,embedding_tokens.gt.0");
  if (f.masLentas) query = query.gt("latency_ms", 30_000);

  if (args.dateRange.from) query = query.gte("created_at", args.dateRange.from);
  if (args.dateRange.to) query = query.lte("created_at", args.dateRange.to);

  const pageSize = args.pageSize ?? RUNS_PAGE_SIZE;
  const from = (f.page - 1) * pageSize;
  const { col: orderCol, ascending } = orderColumn(f.orden, args.includeCost);
  const { data, count, error } = await query.order(orderCol, { ascending }).range(from, from + pageSize - 1);
  if (error) {
    console.error("[runs] no pude leer los runs:", error.message);
    return { rows: [], total: 0 };
  }

  const raw = (data ?? []) as unknown as RawRun[];
  const steps = await loadSteps(client, raw.map((r) => r.id));
  const rows: RunRow[] = raw.map((r) => rowFromRaw(r, { agentNames: args.agentNames, channelLabels: args.channelLabels, includeCost: args.includeCost, steps: steps.get(r.id) ?? [] }));

  return { rows, total: count ?? rows.length };
}

/** Una fila de `agent_runs` ya aplanada, igual en `loadRuns` y en `getRunDetail` (R4: un solo mapeo). */
function rowFromRaw(
  r: RawRun,
  args: { agentNames: Map<string, string>; channelLabels: Map<string, string>; includeCost: boolean; steps: RunStepRow[] },
): RunRow {
  const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
  return {
    id: r.id,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    source: r.source,
    trigger: r.trigger,
    threadId: r.thread_id,
    status: r.status,
    statusDetail: r.status_detail,
    routing: (r.routing ?? null) as Record<string, unknown> | null,
    intent: (r.intent ?? null) as Record<string, unknown> | null,
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
    steps: args.steps,
  };
}

/**
 * Una corrida sola, para `/dashboard/agents/runs/[runId]` (R4): el mismo
 * mapeo que la lista, sin paginar ni filtrar. `null` si no existe o es de
 * otro workspace (la RLS hace el resto con el cliente del usuario).
 */
export async function getRunDetail(
  client: Db,
  args: { runId: string; workspaceId: string; includeCost: boolean; agentNames: Map<string, string>; channelLabels: Map<string, string> },
): Promise<RunRow | null> {
  const cols = args.includeCost ? `${AGENT_RUN_PUBLIC_COLUMNS}, ${COST_COLUMNS}` : AGENT_RUN_PUBLIC_COLUMNS;
  const { data, error } = await client
    .from("agent_runs")
    .select(`${cols}, contacts(display_name)`)
    .eq("id", args.runId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (error || !data) return null;

  const raw = data as unknown as RawRun;
  const steps = await loadSteps(client, [raw.id]);
  return rowFromRaw(raw, { agentNames: args.agentNames, channelLabels: args.channelLabels, includeCost: args.includeCost, steps: steps.get(raw.id) ?? [] });
}

/**
 * El run anterior o siguiente DENTRO del mismo filtro (R4): mismo WHERE que
 * `loadRuns`, pero solo `id` y ordenado desde la fecha de la corrida actual.
 * "Siguiente" es mas vieja (la lista va de mas nueva a mas vieja); "anterior"
 * es mas nueva.
 */
export async function findAdjacentRun(
  client: Db,
  args: { workspaceId: string; filters: RunFilters; includeCost: boolean; dateRange: { from: string | null; to: string | null }; anchorCreatedAt: string; direction: "anterior" | "siguiente" },
): Promise<string | null> {
  const f = args.filters;
  const contactJoin = f.q ? ", contacts!inner(display_name)" : "";
  const stepJoin = f.accion ? ", agent_run_steps!inner(name, kind)" : "";

  let query = client
    .from("agent_runs")
    .select(`id${contactJoin}${stepJoin}`)
    .eq("workspace_id", args.workspaceId);

  if (f.agente === AGENT_FILTER_NONE) query = query.is("agent_id", null);
  else if (f.agente !== AGENT_FILTER_ALL) query = query.eq("agent_id", f.agente);
  if (f.canal) query = query.eq("channel_id", f.canal);
  if (f.contacto) query = query.eq("contact_id", f.contacto);
  if (f.conversacion) query = query.eq("conversation_id", f.conversacion);
  if (f.q) query = query.ilike("contacts.display_name", `%${f.q}%`);
  if (f.resultado) query = query.eq("status", f.resultado as AgentRunStatus);
  if (f.modelo) query = query.eq("model", f.modelo);
  if (f.origen) query = applyOrigenFilter(query, f.origen);
  if (f.accion) query = query.eq("agent_run_steps.kind", "tool_call").eq("agent_run_steps.name", f.accion);
  const detail = runDetailQuery(f.detalle, f.regla);
  if (detail.statusDetailLike) query = query.like("status_detail", detail.statusDetailLike);
  if (detail.routingRuleId) query = query.eq("routing->>rule_id", detail.routingRuleId);
  if (detail.routingRuleIsNull) query = query.eq("routing->>mode", "rules").is("routing->>rule_id", null);
  if (args.includeCost && f.costoMin !== null) query = query.gte("cost_usd", f.costoMin);
  if (args.includeCost && f.costoMax !== null) query = query.lte("cost_usd", f.costoMax);
  if (args.includeCost && f.sinPrecio) query = query.is("cost_usd", null).or("input_tokens.gt.0,embedding_tokens.gt.0");
  if (f.masLentas) query = query.gt("latency_ms", 30_000);
  if (args.dateRange.from) query = query.gte("created_at", args.dateRange.from);
  if (args.dateRange.to) query = query.lte("created_at", args.dateRange.to);

  // Nota: con "Más caras" (orden por costo) activo, anterior/siguiente igual
  // recorre por fecha dentro del mismo filtro: un cursor por costo es otro
  // alcance.
  if (args.direction === "siguiente") query = query.lt("created_at", args.anchorCreatedAt).order("created_at", { ascending: false });
  else query = query.gt("created_at", args.anchorCreatedAt).order("created_at", { ascending: true });

  const { data } = await query.limit(1);
  const row = ((data ?? [])[0] as unknown) as { id: string } | undefined;
  return row?.id ?? null;
}

async function loadSteps(client: Db, runIds: string[]): Promise<Map<string, RunStepRow[]>> {
  const byRun = new Map<string, RunStepRow[]>();
  if (runIds.length === 0) return byRun;

  const { data: steps, error } = await client
    .from("agent_run_steps")
    .select("id, run_id, step_index, kind, name, input, output, kb_chunk_ids, audit_log_id, duration_ms, error, created_at")
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
      createdAt: s.created_at,
      error: s.error,
    });
    byRun.set(s.run_id, list);
  }
  return byRun;
}
