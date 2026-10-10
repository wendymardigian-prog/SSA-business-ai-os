import { describe, it, expect } from "vitest";
import { applyOrigenFilter, countActiveRunFilters, loadRuns, orderColumn, parseRunFilters, RUNS_PAGE_SIZE } from "./runs-query";
import type { RunFilters } from "./screen";

/**
 * Caracterizacion de `loadRuns` con un `agentId` (Bloque R, R1), ANTES de
 * generalizarla para la pantalla global de Corridas. Fija lo que devuelve hoy
 * para que el refactor no le cambie el resultado a la pestaña del agente.
 *
 * El cliente falso resuelve en `.then()` ademas de en `.range()`: `loadRuns`
 * termina su consulta principal con `.range()`, pero `loadSteps` (pasos) y la
 * busqueda de titulos de la base de conocimiento no tienen `.range()` y se
 * esperan directo.
 */
function fakeRunsClient(byTable: Record<string, (filters: Record<string, unknown>) => { data: unknown; count?: number; error?: null }>) {
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(byTable[table]?.(filters) ?? { data: [], error: null });
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
      is: (col: string, val: unknown) => { filters[col] = val; return chain; },
      ilike: (col: string, val: unknown) => { filters[`ilike:${col}`] = val; return chain; },
      like: (col: string, val: unknown) => { filters[`like:${col}`] = val; return chain; },
      gte: (col: string, val: unknown) => { filters[`gte:${col}`] = val; return chain; },
      lte: (col: string, val: unknown) => { filters[`lte:${col}`] = val; return chain; },
      in: (col: string, val: unknown) => { filters[`in:${col}`] = val; return chain; },
      not: () => chain,
      order: () => chain,
      range: resolve,
      then: (onDone: (v: unknown) => unknown) => resolve().then(onDone),
    };
    return chain;
  }
  return { from: builder } as never;
}

const RUN_FIXTURE = {
  id: "run-1",
  source: "agent",
  agent_id: "agent-1",
  prompt_version: 3,
  conversation_id: "conv-1",
  contact_id: "contact-1",
  channel_id: "ch-1",
  trigger: "inbound_message",
  thread_id: null,
  status: "responded",
  status_detail: null,
  routing: { mode: "model" },
  intent: null,
  provider: "anthropic",
  model: "claude-sonnet-5",
  latency_ms: 1200,
  step_count: 1,
  error: null,
  created_at: "2026-09-28T17:00:00Z",
  completed_at: "2026-09-28T17:00:02Z",
  input_tokens: 500,
  output_tokens: 120,
  cached_tokens: 0,
  embedding_tokens: 0,
  cost_usd: 0.0042,
  contacts: { display_name: "Lead de prueba" },
};
const STEP_FIXTURE = {
  id: "step-1",
  run_id: "run-1",
  step_index: 0,
  kind: "kb_search",
  name: null,
  input: null,
  output: { found: 1 },
  kb_chunk_ids: ["chunk-1"],
  audit_log_id: null,
  duration_ms: 80,
  error: null,
  created_at: "2026-09-28T17:00:01Z",
};
const CHUNK_FIXTURE = { id: "chunk-1", chunk_index: 2, knowledge_base: { title: "Guía de precios" } };

function charClient(includeCost: boolean) {
  return fakeRunsClient({
    agent_runs: () => ({ data: [RUN_FIXTURE], count: 1, error: null }),
    agent_run_steps: () => ({ data: [STEP_FIXTURE], error: null }),
    knowledge_chunks: () => ({ data: [CHUNK_FIXTURE], error: null }),
  });
}

const CHAR_EXPECTED_ROW = {
  id: "run-1",
  createdAt: "2026-09-28T17:00:00Z",
  completedAt: "2026-09-28T17:00:02Z",
  source: "agent",
  trigger: "inbound_message",
  status: "responded",
  statusDetail: null,
  agentId: "agent-1",
  agentName: "Asistente",
  promptVersion: 3,
  conversationId: "conv-1",
  contactId: "contact-1",
  contactName: "Lead de prueba",
  channelId: "ch-1",
  channelLabel: "Instagram",
  provider: "anthropic",
  model: "claude-sonnet-5",
  latencyMs: 1200,
  stepCount: 1,
  error: null,
};

describe("loadRuns — caracterizacion con un agentId (antes de generalizar, R1)", () => {
  const args = (includeCost: boolean): Parameters<typeof loadRuns>[1] => ({
    workspaceId: "ws-1",
    filters: {
      page: 1, datePreset: "30d", dateFrom: "", dateTo: "",
      agente: "agent-1", canal: "", contacto: "", conversacion: "", q: "",
      resultado: "", modelo: "", accion: "", regla: "", detalle: "",
      costoMin: null, costoMax: null, origen: "",
    } as RunFilters,
    includeCost,
    agentNames: new Map([["agent-1", "Asistente"]]),
    channelLabels: new Map([["ch-1", "Instagram"]]),
    // El cliente falso no filtra por fecha: lo que importa es que loadRuns ya
    // no resuelve el rango por su cuenta, lo recibe resuelto (D6).
    dateRange: { from: "2026-09-03T06:00:00.000Z", to: null },
  });

  it("Member (sin costo): la forma exacta de hoy", async () => {
    const { rows, total } = await loadRuns(charClient(false), args(false));
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...CHAR_EXPECTED_ROW, cost: null });
    expect(rows[0].steps).toHaveLength(1);
    expect(rows[0].steps[0]).toMatchObject({
      id: "step-1", index: 0, kind: "kb_search", name: null,
      input: null, output: { found: 1 }, auditLogId: null, durationMs: 80, error: null,
      createdAt: "2026-09-28T17:00:01Z",
      kbChunks: [{ id: "chunk-1", label: "Guía de precios · fragmento 3" }],
    });
  });

  it("Admin (con costo): la forma exacta de hoy", async () => {
    const { rows } = await loadRuns(charClient(true), args(true));
    expect(rows[0].cost).toEqual({ usd: 0.0042, inputTokens: 500, outputTokens: 120, cachedTokens: 0, embeddingTokens: 0 });
  });
});

/**
 * Los filtros de Runs vienen de la URL: cualquiera los escribe. Lo que no
 * existe se ignora; el agente de la pestana es el default.
 */

const known = {
  currentAgentId: "agent-1",
  agentIds: ["agent-1", "agent-2"],
  channelIds: ["ch-1"],
  toolNames: ["etiquetar_contacto"],
  models: ["claude-sonnet-5"],
  allowCost: true,
};

describe("parseRunFilters", () => {
  it("sin nada en la URL: pagina 1 y el agente de la pestana", () => {
    const f = parseRunFilters({}, known);
    expect(f).toMatchObject({ page: 1, agente: "agent-1", canal: "", resultado: "", modelo: "", accion: "", costoMin: null, costoMax: null });
    expect(countActiveRunFilters(f, "agent-1")).toBe(0);
  });

  it("valores inventados se ignoran; los validos pasan", () => {
    const f = parseRunFilters(
      {
        agente: "agent-x",
        canal: "ch-9",
        resultado: "explotado",
        modelo: "gpt-99",
        accion: "borrar_todo",
        contacto: "no-es-uuid",
        c: "00000000-0000-4000-8000-000000000001",
        costo_min: "-3",
        costo_max: "0.5",
        fecha: "7d",
        page: "3",
        q: "ana, (x)",
      },
      known,
    );
    expect(f).toMatchObject({
      agente: "agent-1",
      canal: "",
      resultado: "",
      modelo: "",
      accion: "",
      contacto: "",
      conversacion: "00000000-0000-4000-8000-000000000001",
      costoMin: null,
      costoMax: 0.5,
      datePreset: "7d",
      page: 3,
      q: "ana x",
    });
  });

  it("'todos' y 'sin-agente' son valores especiales del filtro de agente", () => {
    expect(parseRunFilters({ agente: "todos" }, known).agente).toBe("todos");
    expect(parseRunFilters({ agente: "sin-agente" }, known).agente).toBe("sin-agente");
    expect(parseRunFilters({ agente: "agent-2" }, known).agente).toBe("agent-2");
  });

  it("un Member no puede filtrar por costo", () => {
    const f = parseRunFilters({ costo_min: "1" }, { ...known, allowCost: false });
    expect(f.costoMin).toBeNull();
  });

  it("cuenta los filtros activos (el agente de la pestana no cuenta)", () => {
    const f = parseRunFilters({ agente: "todos", resultado: "responded", fecha: "hoy" }, known);
    expect(countActiveRunFilters(f, "agent-1")).toBe(3);
  });

  it("orden: sin nada en la URL, 'recientes'", () => {
    expect(parseRunFilters({}, known).orden).toBe("recientes");
  });

  it("orden: un valor valido pasa tal cual", () => {
    expect(parseRunFilters({ orden: "lentas" }, known).orden).toBe("lentas");
    expect(parseRunFilters({ orden: "antiguas" }, known).orden).toBe("antiguas");
  });

  it("orden: un valor inventado cae a 'recientes'", () => {
    expect(parseRunFilters({ orden: "al-azar" }, known).orden).toBe("recientes");
  });

  it("orden: 'caras'/'baratas' sin permiso de costo caen a 'recientes'", () => {
    expect(parseRunFilters({ orden: "caras" }, { ...known, allowCost: false }).orden).toBe("recientes");
    expect(parseRunFilters({ orden: "baratas" }, { ...known, allowCost: false }).orden).toBe("recientes");
  });

  it("compatibilidad: el link viejo 'caras=1' sigue poniendo orden=caras", () => {
    expect(parseRunFilters({ caras: "1" }, known).orden).toBe("caras");
    expect(parseRunFilters({ caras: "1" }, { ...known, allowCost: false }).orden).toBe("recientes");
  });

  it("origen admite siempre el pseudo-valor close_classification (no es un source real): quien decide si ofrecerlo como opcion es runs-screen-data.ts", () => {
    const f = parseRunFilters({ origen: "close_classification" }, { ...known, sources: ["agent"] });
    expect(f.origen).toBe("close_classification");
  });
});

describe("applyOrigenFilter", () => {
  function fakeQuery() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const chain = {
      eq: (...args: unknown[]) => {
        calls.push({ fn: "eq", args });
        return chain;
      },
      like: (...args: unknown[]) => {
        calls.push({ fn: "like", args });
        return chain;
      },
    };
    return { chain, calls };
  }

  it("un source real: un solo eq", () => {
    const { chain, calls } = fakeQuery();
    applyOrigenFilter(chain, "agent");
    expect(calls).toEqual([{ fn: "eq", args: ["source", "agent"] }]);
  });

  it("close_classification: source=conversation_summary y status_detail LIKE %classified%", () => {
    const { chain, calls } = fakeQuery();
    applyOrigenFilter(chain, "close_classification");
    expect(calls).toEqual([
      { fn: "eq", args: ["source", "conversation_summary"] },
      { fn: "like", args: ["status_detail", "%classified%"] },
    ]);
  });
});

describe("orderColumn", () => {
  it("default y 'recientes': created_at descendente", () => {
    expect(orderColumn(undefined, true)).toEqual({ col: "created_at", ascending: false });
    expect(orderColumn("recientes", true)).toEqual({ col: "created_at", ascending: false });
  });
  it("antiguas: created_at ascendente", () => {
    expect(orderColumn("antiguas", true)).toEqual({ col: "created_at", ascending: true });
  });
  it("lentas/rapidas: latency_ms", () => {
    expect(orderColumn("lentas", true)).toEqual({ col: "latency_ms", ascending: false });
    expect(orderColumn("rapidas", true)).toEqual({ col: "latency_ms", ascending: true });
  });
  it("caras/baratas: cost_usd, solo con permiso de costo", () => {
    expect(orderColumn("caras", true)).toEqual({ col: "cost_usd", ascending: false });
    expect(orderColumn("baratas", true)).toEqual({ col: "cost_usd", ascending: true });
    expect(orderColumn("caras", false)).toEqual({ col: "created_at", ascending: false });
    expect(orderColumn("baratas", false)).toEqual({ col: "created_at", ascending: false });
  });
});
