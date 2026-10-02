import { describe, it, expect } from "vitest";
import { loadAiDashboardData, loadAiScatter, resolveAiRange } from "./data";
import { DEFAULT_AI_PERIOD } from "./url-state";

const TZ = "America/Costa_Rica";
const NOW = new Date("2026-10-02T15:00:00Z"); // 09:00 del 2/10 en Costa Rica

describe("resolveAiRange", () => {
  it("un preset se resuelve y trae su periodo anterior", () => {
    const { range, previous } = resolveAiRange({ period: "7d", from: null, to: null }, TZ, NOW);
    expect(range.from).not.toBeNull();
    expect(previous.from).not.toBeNull();
    expect(new Date(previous.to as string).getTime()).toBeLessThan(new Date(range.from as string).getTime());
  });

  it("un rango a medida (from/to) gana al preset", () => {
    const { range } = resolveAiRange({ period: DEFAULT_AI_PERIOD, from: "2026-09-01T06:00:00.000Z", to: "2026-09-10T06:00:00.000Z" }, TZ, NOW);
    expect(range).toEqual({ from: "2026-09-01T06:00:00.000Z", to: "2026-09-10T06:00:00.000Z" });
  });

  it("historico no tiene periodo anterior", () => {
    const { previous } = resolveAiRange({ period: "historico", from: null, to: null }, TZ, NOW);
    expect(previous).toEqual({ from: null, to: null });
  });
});

interface FakeCall {
  fn: string;
  args: unknown;
}

function fakeService(opts: {
  reports: Record<string, { totals: Record<string, number> }>;
  spendByDay?: unknown[];
  scatter?: unknown[];
}) {
  const calls: FakeCall[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "ai_cost_report") {
        const key = `${args.p_from}|${args.p_to}`;
        return { data: opts.reports[key] ?? null, error: null };
      }
      if (fn === "ai_spend_by_day") return { data: opts.spendByDay ?? [], error: null };
      if (fn === "ai_runs_scatter") return { data: opts.scatter ?? [], error: null };
      throw new Error(`rpc inesperada: ${fn}`);
    },
  };
  return { client: client as never, calls };
}

function emptyTotals(cost: number, runs = 1) {
  return {
    totals: {
      runs,
      cost_usd: cost,
      conversations: 0,
      escalations: 0,
      responded: 0,
      missing_pricing: 0,
      input_tokens: 10,
      output_tokens: 5,
      cached_tokens: 0,
      embedding_tokens: 0,
    },
  };
}

describe("loadAiDashboardData", () => {
  it("hace a lo sumo tres llamadas: el informe del periodo, el del anterior y la serie por dia", async () => {
    const { client, calls } = fakeService({ reports: {} });
    await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "30d", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(calls.map((c) => c.fn).sort()).toEqual(["ai_cost_report", "ai_cost_report", "ai_spend_by_day"]);
  });

  it("en historico, sin periodo anterior, no llama ai_cost_report una segunda vez", async () => {
    const { client, calls } = fakeService({ reports: {} });
    await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "historico", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(calls.filter((c) => c.fn === "ai_cost_report")).toHaveLength(1);
  });

  it("gasto de hoy y de ayer se leen de la serie por dia, no de una llamada aparte", async () => {
    const { client } = fakeService({
      reports: {},
      spendByDay: [
        { day: "2026-10-01", source: "agent", runs: 2, cost_usd: 0.5, input_tokens: 10, output_tokens: 5, missing_pricing: 0 },
        { day: "2026-10-02", source: "agent", runs: 1, cost_usd: 0.2, input_tokens: 10, output_tokens: 5, missing_pricing: 0 },
      ],
    });
    const data = await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "30d", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(data.todayCost).toBeCloseTo(0.2);
    expect(data.yesterdayCost).toBeCloseTo(0.5);
  });

  it("si hoy no esta en la serie (un periodo que no llega hasta hoy), el valor es null", async () => {
    const { client } = fakeService({ reports: {}, spendByDay: [{ day: "2026-08-01", source: "agent", runs: 1, cost_usd: 1, input_tokens: 1, output_tokens: 1, missing_pricing: 0 }] });
    const data = await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "mes-pasado", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(data.todayCost).toBeNull();
    expect(data.yesterdayCost).toBeNull();
  });

  it("totales y totales anteriores vienen del informe correspondiente", async () => {
    // loadAiDashboardData le pasa a fetchCostReport un `to` cerrado (un `to`
    // abierto se resuelve a "ahora + 1 minuto", igual que costs-query.ts):
    // la clave tiene que reflejar eso, no el `to: null` crudo del periodo.
    const { range, previous } = resolveAiRange({ period: "30d", from: null, to: null }, TZ, NOW);
    const close = (iso: string | null, fallback: Date) => (iso ? new Date(iso) : fallback).toISOString();
    const soon = new Date(NOW.getTime() + 60_000);
    const { client } = fakeService({
      reports: {
        [`${close(range.from, new Date(0))}|${close(range.to, soon)}`]: emptyTotals(5, 20),
        [`${close(previous.from, new Date(0))}|${close(previous.to, soon)}`]: emptyTotals(3, 15),
      },
    });
    const data = await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "30d", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(data.totals).toMatchObject({ runs: 20, costUsd: 5 });
    expect(data.previousTotals).toMatchObject({ runs: 15, costUsd: 3 });
  });

  it("sin informe (null del servidor), da totales en cero y no explota", async () => {
    const { client } = fakeService({ reports: {} });
    const data = await loadAiDashboardData(client, { workspaceId: "ws-1", filter: { period: "30d", from: null, to: null }, timeZone: TZ, now: NOW });
    expect(data.totals).toMatchObject({ runs: 0, costUsd: 0 });
  });
});

describe("loadAiScatter", () => {
  it("es la cuarta llamada, aparte: solo se pide cuando se la invoca", async () => {
    const { client, calls } = fakeService({ reports: {}, scatter: [{ id: "r1", created_at: "2026-10-01T00:00:00Z", source: "agent", status: "responded", cost_usd: "0.01", latency_ms: 500, input_tokens: 10, total_tokens: "15", conversation_id: null }] });
    const rows = await loadAiScatter(client, { workspaceId: "ws-1", range: { from: null, to: null } });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("ai_runs_scatter");
    expect(rows[0]).toMatchObject({ id: "r1", cost_usd: 0.01, total_tokens: 15 });
  });

  it("si la RPC falla, devuelve una lista vacia (no rompe la pestaña)", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as never;
    expect(await loadAiScatter(client, { workspaceId: "ws-1", range: { from: null, to: null } })).toEqual([]);
  });
});
