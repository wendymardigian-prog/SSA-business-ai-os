import { describe, expect, it } from "vitest";
import { loadTaskRunSummaries, loadTaskRunSummary } from "./task-run-summary";
import { AI_TASKS, ALL_AI_TASKS } from "./catalog";

function fakeClient(opts: {
  lastRun?: { status: string; status_detail: string | null; completed_at: string | null; created_at: string } | null;
  bySource?: Array<{ source: string; runs?: number; cost_usd: number }>;
  /** Las filas de agent_runs del mes que se suman para una tarea sin source propio. */
  monthRows?: Array<{ cost_usd: number | string | null }>;
}) {
  return {
    from() {
      const calls: string[] = [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        like: (col: string, val: string) => {
          calls.push(`like:${col}:${val}`);
          return chain;
        },
        order: () => chain,
        gte: () => chain,
        lt: () => chain,
        neq: () => chain,
        range: async () => ({ data: opts.monthRows ?? [], error: null }),
        limit: () => chain,
        maybeSingle: async () => ({ data: opts.lastRun ?? null, error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: { by_source: opts.bySource ?? [] }, error: null }),
  } as never;
}

describe("loadTaskRunSummary", () => {
  it("una tarea con source propio: ultima corrida y gasto del mes", async () => {
    const client = fakeClient({
      lastRun: { status: "completed", status_detail: null, completed_at: "2026-10-01T03:00:00Z", created_at: "2026-10-01T02:59:00Z" },
      bySource: [{ source: "message_classification", runs: 4, cost_usd: 1.23 }],
    });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.message_classification);
    expect(got).toEqual({ at: "2026-10-01T03:00:00Z", status: "completed", detail: null, monthSpendUsd: 1.23, monthRuns: 4 });
  });

  it("sin corridas: todo null", async () => {
    const client = fakeClient({ lastRun: null, bySource: [] });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.audio_transcription);
    expect(got).toEqual({ at: null, status: null, detail: null, monthSpendUsd: null, monthRuns: 0 });
  });

  it("close_classification: su gasto se suma de sus propias corridas, no del total del resumen", async () => {
    const client = fakeClient({
      lastRun: null,
      bySource: [{ source: "conversation_summary", runs: 9, cost_usd: 5 }],
      monthRows: [{ cost_usd: "0.01" }, { cost_usd: 0.02 }, { cost_usd: null }],
    });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.close_classification);
    expect(got.monthSpendUsd).toBeCloseTo(0.03);
    expect(got.monthRuns).toBe(3);
  });
});

describe("loadTaskRunSummaries", () => {
  it("pide el reporte de costos UNA vez para todas las tareas", async () => {
    let rpcCalls = 0;
    const base = fakeClient({ lastRun: null, bySource: [{ source: "message_classification", cost_usd: 2 }] }) as unknown as { from: unknown; rpc: () => Promise<unknown> };
    const client = { from: base.from, rpc: async () => (rpcCalls++, base.rpc()) } as never;
    const got = await loadTaskRunSummaries(client, "ws-1", ALL_AI_TASKS);
    expect(rpcCalls).toBe(1);
    expect(got).toHaveLength(ALL_AI_TASKS.length);
    expect(got[ALL_AI_TASKS.findIndex((t) => t.id === "message_classification")].monthSpendUsd).toBe(2);
  });
});
