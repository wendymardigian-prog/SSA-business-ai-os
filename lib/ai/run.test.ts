import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { closeStaleRuns, openAiRun, recordRunOutcome, summarizeForStep } from "./run";

interface PriceRow {
  id: string;
  workspace_id: string;
  provider: string;
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number;
  valid_from: string;
}

/**
 * Cliente falso con la parte de PostgREST que usa el run: insert del run y de
 * los pasos, update del cierre, y la consulta de precios con lte/order/limit.
 * Aplica los filtros de verdad sobre las filas de precios, asi el test de
 * "precio vigente" prueba la consulta y no un mock que devuelve lo que se le pide.
 */
function fakeDb(prices: PriceRow[] = [], opts: { failInsert?: boolean } = {}) {
  const runs: Array<Record<string, unknown>> = [];
  const steps: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const from = (table: string) => {
    const filters: Array<(row: PriceRow) => boolean> = [];
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;

    const builder: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        pendingInsert = row;
        return builder;
      },
      update: (row: Record<string, unknown>) => {
        pendingUpdate = row;
        return builder;
      },
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
        return builder;
      },
      lt: () => builder,
      lte: (col: string, val: string) => {
        filters.push((r) => (r as unknown as Record<string, string>)[col] <= val);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      single: async () => {
        if (opts.failInsert) return { data: null, error: { message: "boom" } };
        if (table === "agent_runs" && pendingInsert) {
          runs.push(pendingInsert);
          return { data: { id: `run-${runs.length}` }, error: null };
        }
        if (table === "agent_run_steps" && pendingInsert) {
          steps.push(pendingInsert);
          return { data: { id: `step-${steps.length}` }, error: null };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        const match = prices
          .filter((p) => filters.every((f) => f(p)))
          .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
        return { data: match ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (pendingUpdate) updates.push(pendingUpdate);
        return resolve({ data: [{ id: "stale-1" }], error: null });
      },
    };
    return builder;
  };

  return { client: { from } as unknown as SupabaseClient<Database>, runs, steps, updates };
}

const SONNET_2026: PriceRow = {
  id: "price-sonnet",
  workspace_id: "ws-1",
  provider: "anthropic",
  model: "claude-sonnet-5",
  input_per_mtok: 2,
  output_per_mtok: 10,
  cached_input_per_mtok: 0.2,
  valid_from: "2026-09-13T00:00:00.000Z",
};
const VOYAGE: PriceRow = {
  id: "price-voyage",
  workspace_id: "ws-1",
  provider: "voyage",
  model: "voyage-4-lite",
  input_per_mtok: 0.02,
  output_per_mtok: 0,
  cached_input_per_mtok: 0,
  valid_from: "2026-09-13T00:00:00.000Z",
};

const BASE = { workspaceId: "ws-1", source: "agent" as const, trigger: "inbound_message" as const };

let t = 0;
const clock = () => new Date(Date.UTC(2026, 8, 20, 12, 0, 0) + t);

beforeEach(() => {
  t = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("abrir y cerrar un run", () => {
  it("se abre en running antes de la llamada y se cierra con latencia, tokens y costo congelado", async () => {
    const { client, runs, updates } = fakeDb([SONNET_2026]);
    const run = await openAiRun(client, BASE, clock);

    expect(runs[0]).toMatchObject({ status: "running", source: "agent" });
    run.setModel("anthropic", "claude-sonnet-5");
    run.setFinalUsage({ inputTokens: 1_000_000, outputTokens: 100_000, inputTokenDetails: { cacheReadTokens: 0 } });
    t = 1_500;
    const result = await run.close({ status: "responded" });

    expect(result.costUsd).toBe(3);
    expect(updates[0]).toMatchObject({
      status: "responded",
      cost_usd: 3,
      pricing_id: "price-sonnet",
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      latency_ms: 1_500,
    });
  });

  it("los tokens cacheados no se cuentan dos veces en el run", async () => {
    const { client, updates } = fakeDb([SONNET_2026]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("anthropic", "claude-sonnet-5");
    run.setFinalUsage({ inputTokens: 1_000_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 800_000 } });
    await run.close({ status: "responded" });

    expect(updates[0]).toMatchObject({ cost_usd: 0.56, cached_tokens: 800_000 });
  });

  it("el costo de los embeddings del turno entra al MISMO run", async () => {
    const { client, updates } = fakeDb([SONNET_2026, VOYAGE]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("anthropic", "claude-sonnet-5");
    run.setFinalUsage({ inputTokens: 1_000_000, outputTokens: 0 });
    run.addEmbeddingUsage({ provider: "voyage", model: "voyage-4-lite", tokens: 300_000 });
    run.addEmbeddingUsage({ provider: "voyage", model: "voyage-4-lite", tokens: 200_000 });
    await run.close({ status: "responded" });

    // 2 USD de chat + 500.000 x 0,02 / 1M = 0,01 de Voyage.
    expect(updates[0]).toMatchObject({ cost_usd: 2.01, embedding_tokens: 500_000 });
  });
});

describe("los dos cubos de tokens", () => {
  it("si el turno termina bien manda el total final, y lo acumulado por paso no se suma encima", async () => {
    const { client, updates } = fakeDb([SONNET_2026]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("anthropic", "claude-sonnet-5");
    run.addStepUsage({ inputTokens: 500_000, outputTokens: 50_000 });
    run.addStepUsage({ inputTokens: 500_000, outputTokens: 50_000 });
    run.setFinalUsage({ inputTokens: 1_000_000, outputTokens: 100_000 });
    await run.close({ status: "responded" });

    expect(updates[0]).toMatchObject({ cost_usd: 3, input_tokens: 1_000_000 });
  });

  it("si se corta por timeout, el run guarda igual lo que ya se gasto en los pasos", async () => {
    const { client, updates } = fakeDb([SONNET_2026]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("anthropic", "claude-sonnet-5");
    run.addStepUsage({ inputTokens: 500_000, outputTokens: 50_000 });
    // Nunca llega setFinalUsage: el turno se aborto.
    await run.close({ status: "error", statusDetail: "model_timeout" });

    expect(updates[0]).toMatchObject({ status: "error", cost_usd: 1.5, input_tokens: 500_000 });
  });
});

describe("precios", () => {
  it("un modelo sin precio cargado: el run se guarda igual, con costo null y el aviso", async () => {
    const { client, updates } = fakeDb([]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("openai", "gpt-9-preview");
    run.setFinalUsage({ inputTokens: 1000, outputTokens: 10 });
    const result = await run.close({ status: "responded" });

    expect(result.costUsd).toBeNull();
    expect(updates[0]).toMatchObject({ status: "responded", cost_usd: null, input_tokens: 1000 });
    expect(String(updates[0].status_detail)).toContain("pricing_missing:openai/gpt-9-preview");
  });

  it("si falta el precio de los embeddings, el total es desconocido: no se guarda un parcial", async () => {
    const { client, updates } = fakeDb([SONNET_2026]);
    const run = await openAiRun(client, BASE, clock);
    run.setModel("anthropic", "claude-sonnet-5");
    run.setFinalUsage({ inputTokens: 1000, outputTokens: 10 });
    run.addEmbeddingUsage({ provider: "voyage", model: "voyage-4-lite", tokens: 100 });
    await run.close({ status: "responded" });

    expect(updates[0].cost_usd).toBeNull();
  });

  it("se aplica el precio vigente al cierre; un precio posterior no cambia un run viejo", async () => {
    const SUBA: PriceRow = { ...SONNET_2026, id: "price-suba", input_per_mtok: 4, valid_from: "2026-10-01T00:00:00.000Z" };
    const { client, updates } = fakeDb([SONNET_2026, SUBA]);

    const run = await openAiRun(client, BASE, clock); // 2026-09-20
    run.setModel("anthropic", "claude-sonnet-5");
    run.setFinalUsage({ inputTokens: 1_000_000, outputTokens: 0 });
    await run.close({ status: "responded" });

    expect(updates[0]).toMatchObject({ cost_usd: 2, pricing_id: "price-sonnet" });
  });

  it("un run sin ninguna llamada al modelo cuesta 0 (abstenciones, guardarrailes)", async () => {
    const { client, updates } = fakeDb([]);
    await recordRunOutcome(client, { ...BASE, status: "skipped_automation", statusDetail: "flow" });

    expect(updates[0]).toMatchObject({ status: "skipped_automation", cost_usd: 0, input_tokens: null });
  });
});

describe("registrar nunca rompe al que llama", () => {
  it("si no se pudo abrir el run, el handle sigue andando sin id", async () => {
    const { client, updates } = fakeDb([], { failInsert: true });
    const run = await openAiRun(client, BASE, clock);

    expect(run.runId).toBeNull();
    await expect(run.step({ kind: "model_call" })).resolves.toBeNull();
    await expect(run.close({ status: "responded" })).resolves.toBeDefined();
    expect(updates).toHaveLength(0);
  });

  it("cerrar dos veces no escribe dos veces", async () => {
    const { client, updates } = fakeDb([]);
    const run = await openAiRun(client, BASE, clock);
    await run.close({ status: "responded" });
    await run.close({ status: "error" });

    expect(updates).toHaveLength(1);
  });
});

describe("pasos", () => {
  it("se numeran en orden y el conteo llega al cierre", async () => {
    const { client, steps, updates } = fakeDb([]);
    const run = await openAiRun(client, BASE, clock);
    await Promise.all([
      run.step({ kind: "kb_search", kbChunkIds: ["c1", "c2"] }),
      run.step({ kind: "tool_call", name: "derivar_a_humano", auditLogId: "audit-1" }),
    ]);
    await run.close({ status: "escalated" });

    expect(steps.map((s) => s.step_index)).toEqual([0, 1]);
    expect(steps[0].kb_chunk_ids).toEqual(["c1", "c2"]);
    expect(steps[1].audit_log_id).toBe("audit-1");
    expect(updates[0].step_count).toBe(2);
  });

  it("la salida del paso se resume: strings largos recortados", () => {
    const largo = "x".repeat(10_000);
    const out = summarizeForStep({ texto: largo }) as { texto: string };
    expect(out.texto.length).toBeLessThan(2_100);
  });
});

describe("runs colgados", () => {
  it("cierra en error los que siguen en running", async () => {
    const { client, updates } = fakeDb([]);
    const closed = await closeStaleRuns(client, { now: new Date("2026-09-20T12:00:00Z") });

    expect(closed).toBe(1);
    expect(updates[0]).toMatchObject({ status: "error", status_detail: "stale_running" });
  });
});
