import { describe, expect, it } from "vitest";
import { loadTaskRunSummaries, loadTaskRunSummary } from "./task-run-summary";
import { AI_TASKS, ALL_AI_TASKS } from "./catalog";

function fakeClient(opts: { lastRun?: { status: string; status_detail: string | null; completed_at: string | null; created_at: string } | null; bySource?: Array<{ source: string; cost_usd: number }> }) {
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
      bySource: [{ source: "message_classification", cost_usd: 1.23 }],
    });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.message_classification);
    expect(got).toEqual({ at: "2026-10-01T03:00:00Z", status: "completed", detail: null, monthSpendUsd: 1.23 });
  });

  it("sin corridas: todo null", async () => {
    const client = fakeClient({ lastRun: null, bySource: [] });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.audio_transcription);
    expect(got).toEqual({ at: null, status: null, detail: null, monthSpendUsd: null });
  });

  it("close_classification: el gasto queda null (comparte source con conversation_summary, no se puede separar)", async () => {
    const client = fakeClient({ lastRun: null, bySource: [{ source: "conversation_summary", cost_usd: 5 }] });
    const got = await loadTaskRunSummary(client, "ws-1", AI_TASKS.close_classification);
    expect(got.monthSpendUsd).toBeNull();
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
