import { describe, it, expect } from "vitest";
import { memoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";
import { toAgentConfig } from "./config";
import { loadCostsTab, loadHeaderKpis, parseCostFilters } from "./costs-query";

/**
 * La pestana Costos arma sus numeros a partir del RPC ai_cost_report (00069),
 * que aca se simula. Lo que se prueba es la traduccion: promedios, etiquetas,
 * nombres, precios y el vacio.
 */

const rpcReport = {
  totals: { runs: 4, cost_usd: "0.08", conversations: 2, escalations: 1, responded: 3, missing_pricing: 1, input_tokens: 4000, output_tokens: 400, cached_tokens: 0, embedding_tokens: 100 },
  by_source: [{ source: "agent", runs: 3, cost_usd: "0.07" }, { source: "conversation_summary", runs: 1, cost_usd: "0.01" }],
  by_agent: [{ agent_id: "agent-1", runs: 4, cost_usd: "0.08" }],
  by_model: [{ provider: "anthropic", model: "claude-sonnet-5", runs: 4, cost_usd: "0.08", input_tokens: 4000, output_tokens: 400, missing_pricing: 1 }],
  top_conversations: [{ conversation_id: "cv-1", contact_id: "c-1", runs: 3, cost_usd: "0.07" }],
};

function world(report: unknown = rpcReport) {
  return memoryDb(
    {
      contacts: [{ id: "c-1", display_name: "Ana" }],
      model_pricing: [{ id: "p-1", workspace_id: "ws-1", provider: "anthropic", model: "claude-sonnet-5", input_per_mtok: "3", output_per_mtok: "15", cached_input_per_mtok: "0.3", valid_from: "2026-09-13T00:00:00Z", note: null }],
      agent_runs: [{ id: "r-1", workspace_id: "ws-1", agent_id: "agent-1", created_at: "2026-09-24T14:00:00Z" }],
    },
    { rpc: { ai_cost_report: () => report } },
  );
}

const agent = toAgentConfig(agentRow());

describe("parseCostFilters", () => {
  it("arranca en los ultimos 30 dias y acepta presets validos", () => {
    expect(parseCostFilters({}).datePreset).toBe("30d");
    expect(parseCostFilters({ fecha: "hoy" }).datePreset).toBe("hoy");
    expect(parseCostFilters({ fecha: "inventado" }).datePreset).toBe("30d");
  });
});

describe("loadCostsTab", () => {
  it("traduce el reporte: promedios, etiquetas, nombres del top 10 y precios", async () => {
    const db = world();
    const data = await loadCostsTab(db.client, {
      workspaceId: "ws-1",
      agent,
      filters: parseCostFilters({}),
      agentNames: new Map([["agent-1", "Asistente"]]),
      workspaceLimits: { daily: null, monthly: 200 },
      canEditPricing: true,
    });
    expect(data.report.totals).toMatchObject({ runs: 4, costUsd: 0.08, conversations: 2, escalations: 1, missingPricing: 1 });
    expect(data.averages).toEqual({ perRun: 0.02, perConversation: 0.04, perEscalation: 0.08, escalationRatePct: 25 });
    expect(data.report.bySource[1]).toMatchObject({ label: "Resumen de conversacion", costUsd: 0.01 });
    expect(data.report.byAgent[0]).toMatchObject({ name: "Asistente" });
    expect(data.report.topConversations[0]).toMatchObject({ contactName: "Ana", costUsd: 0.07 });
    expect(data.pricing[0]).toMatchObject({ inputPerMtok: 3, outputPerMtok: 15, cachedInputPerMtok: 0.3 });
    expect(data.limits).toMatchObject({ agentDailyUsd: 5, workspaceMonthlyUsd: 200 });
    const call = db.rpcCalls.find((c) => c.name === "ai_cost_report");
    expect(call?.args).toMatchObject({ p_workspace_id: "ws-1" });
  });

  it("sin runs, los promedios son null y nada explota", async () => {
    const db = world({ totals: { runs: 0, cost_usd: 0, conversations: 0, escalations: 0, responded: 0, missing_pricing: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, embedding_tokens: 0 }, by_source: [], by_agent: [], by_model: [], top_conversations: [] });
    const data = await loadCostsTab(db.client, { workspaceId: "ws-1", agent, filters: parseCostFilters({}), agentNames: new Map(), workspaceLimits: { daily: null, monthly: null }, canEditPricing: false });
    expect(data.averages).toEqual({ perRun: null, perConversation: null, perEscalation: null, escalationRatePct: null });
    expect(data.report.topConversations).toEqual([]);
  });
});

describe("loadHeaderKpis", () => {
  it("runs de hoy, gasto del mes y % de derivaciones", async () => {
    const db = world();
    const kpis = await loadHeaderKpis(db.client, { workspaceId: "ws-1", agentId: "agent-1", now: new Date("2026-09-24T18:00:00Z") });
    expect(kpis).toEqual({ runsToday: 1, monthCostUsd: 0.08, escalationRatePct: 25, missingPricing: 1 });
  });
});

describe("borradores en Costos (Bloque 2c)", () => {
  const load = (report: unknown) =>
    loadCostsTab(world(report).client, {
      workspaceId: "ws-1",
      agent,
      filters: parseCostFilters({}),
      agentNames: new Map(),
      workspaceLimits: { daily: null, monthly: null },
      canEditPricing: false,
    });

  it("lee el gasto en borradores descartados y los enviados sin editar", async () => {
    const data = await load({
      ...rpcReport,
      totals: { ...rpcReport.totals, drafted: 5 },
      drafts: { discarded: 2, discarded_cost_usd: "0.03", sent: 3, sent_unedited: 2 },
    });
    expect(data.report.drafts).toEqual({ drafted: 5, discarded: 2, discardedCostUsd: 0.03, sent: 3, sentUnedited: 2 });
  });

  it("un reporte sin la parte de borradores (antes de la 00071) no rompe nada", async () => {
    const data = await load(rpcReport);
    expect(data.report.drafts).toEqual({ drafted: 0, discarded: 0, discardedCostUsd: 0, sent: 0, sentUnedited: 0 });
  });
});
