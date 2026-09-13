import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildAiMessages, generateAiReply } from "./generate-reply";

const WS = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";

vi.mock("./provider", () => ({ getWorkspaceModel: vi.fn() }));
vi.mock("ai", () => ({ generateText: vi.fn() }));

// El run se prueba en run.test.ts. Aca importa que se abra con la procedencia
// correcta, que reciba el total de tokens del SDK y que se cierre.
const runHandle = vi.hoisted(() => ({
  runId: "run-1",
  setModel: vi.fn(),
  addStepUsage: vi.fn(),
  setFinalUsage: vi.fn(),
  addEmbeddingUsage: vi.fn(),
  step: vi.fn().mockResolvedValue("step-1"),
  close: vi.fn().mockResolvedValue({ costUsd: 0, pricingMissing: [] }),
}));
vi.mock("./run", () => ({ openAiRun: vi.fn().mockResolvedValue(runHandle) }));

import { getWorkspaceModel } from "./provider";
import { generateText } from "ai";
import { openAiRun } from "./run";

/**
 * Cliente falso que registra en que tablas se escribio.
 *
 * Lo importante que se afirma con esto es negativo: este modulo NO puede tocar
 * flow_sessions. Si lo hiciera, un paso de secuencia (que no tiene sesion)
 * estaria escribiendo sobre una fila que no le corresponde.
 */
function fakeClient(messages: Array<{ direction: string; text: string | null }> = []) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const touched: string[] = [];

  const client = {
    from(table: string) {
      touched.push(table);
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: null };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: messages, error: null }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, inserts, touched };
}

const TRACE = { source: "sequence" as const, sequenceId: "seq-1", enrollmentId: "enr-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openAiRun).mockResolvedValue(runHandle);
  runHandle.step.mockResolvedValue("step-1");
  runHandle.close.mockResolvedValue({ costUsd: 0, pricingMissing: [] });
});

const traces = (inserts: Array<{ table: string; row: Record<string, unknown> }>) =>
  inserts.filter((i) => i.table === "analytics_events").map((i) => i.row);
afterEach(() => vi.restoreAllMocks());

describe("buildAiMessages", () => {
  it("da vuelta el orden: la consulta trae lo mas nuevo primero y el modelo lo necesita al reves", () => {
    const result = buildAiMessages([
      { direction: "outbound", text: "segundo" },
      { direction: "inbound", text: "primero" },
    ]);
    expect(result).toEqual([
      { role: "user", content: "primero" },
      { role: "assistant", content: "segundo" },
    ]);
  });

  it("descarta los mensajes sin texto en vez de mandar contenido vacio", () => {
    expect(buildAiMessages([{ direction: "inbound", text: null }])).toEqual([]);
  });
});

describe("generateAiReply", () => {
  it("sin proveedor conectado avisa por que y deja la traza, sin lanzar", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: false,
      problem: "no_provider",
      message: "No hay ningun proveedor de IA conectado.",
    });
    const { client, inserts, touched } = fakeClient();

    const result = await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      trace: TRACE,
    });

    expect(result).toEqual({
      ok: false,
      problem: "no_provider",
      message: "No hay ningun proveedor de IA conectado.",
      runId: "run-1",
    });
    // Tambien sin proveedor queda el run, en error y sin costo.
    expect(runHandle.close).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", statusDetail: "no_provider" }),
    );
    expect(inserts[0].table).toBe("analytics_events");
    expect(inserts[0].row.event_type).toBe("ai_response_failed");
    expect(touched).not.toContain("flow_sessions");
  });

  it("si el proveedor tira, devuelve generation_failed en vez de propagar la excepcion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "anthropic",
      modelId: "claude-x",
    });
    vi.mocked(generateText).mockRejectedValue(new Error("401 invalid api key"));
    const { client, inserts } = fakeClient([{ direction: "inbound", text: "hola" }]);

    const result = await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      trace: TRACE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("generation_failed");
    // El mensaje que se muestra nunca repite el error crudo del proveedor.
    expect(result.message).not.toContain("401");
    expect(traces(inserts)[0].event_type).toBe("ai_response_failed");
    expect(runHandle.close).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", statusDetail: "generation_failed" }),
    );
    // El error crudo del proveedor tampoco va al run.
    const closeArg = runHandle.close.mock.calls[0][0] as { error: string };
    expect(closeArg.error).not.toContain("401");
  });

  it("en el camino feliz devuelve el texto y anota la procedencia de la secuencia", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "anthropic",
      modelId: "claude-x",
    });
    const usage = { inputTokens: 120, outputTokens: 30, inputTokenDetails: { cacheReadTokens: 0 } };
    vi.mocked(generateText).mockResolvedValue({ text: "listo", totalUsage: usage } as never);
    const { client, inserts, touched } = fakeClient([{ direction: "inbound", text: "hola" }]);

    const result = await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      trace: TRACE,
    });

    expect(result).toMatchObject({ ok: true, text: "listo", provider: "anthropic" });
    const trace = traces(inserts)[0];
    expect(trace.event_type).toBe("ai_response_generated");
    // Sin flow: la columna queda nula y la procedencia se lee en la metadata.
    expect(trace.flow_id).toBeNull();
    expect(trace.metadata).toMatchObject({ source: "sequence", sequence_id: "seq-1" });
    expect(touched).not.toContain("flow_sessions");
    expect(touched).not.toContain("messages_insert");

    // El run: procedencia de secuencia, modelo realmente usado, total del SDK.
    expect(openAiRun).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ source: "sequence_ai_step", trigger: "sequence_step", threadId: "enr-1" }),
    );
    expect(runHandle.setModel).toHaveBeenCalledWith("anthropic", "claude-x");
    expect(runHandle.setFinalUsage).toHaveBeenCalledWith(usage);
    expect(runHandle.close).toHaveBeenCalledWith({ status: "completed" });
    expect(result).toMatchObject({ runId: "run-1" });
  });

  it("desde un flow, el run es flow_ai_node y se agrupa por el flow", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "openai",
      modelId: "gpt-x",
    });
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never);
    const { client } = fakeClient([{ direction: "inbound", text: "hola" }]);

    await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      trace: { source: "flow", flowId: "flow-9" },
    });

    expect(openAiRun).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ source: "flow_ai_node", trigger: "flow_node", threadId: "flow-9", conversationId: CONV }),
    );
  });

  it("si quien llama ya abrio el run, lo usa y no lo cierra: el cierre es de quien lo abrio", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "openai",
      modelId: "gpt-x",
    });
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never);
    const { client } = fakeClient([{ direction: "inbound", text: "hola" }]);

    await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      trace: TRACE,
      run: runHandle,
    });

    expect(openAiRun).not.toHaveBeenCalled();
    expect(runHandle.close).not.toHaveBeenCalled();
  });

  it("con el historial vacio manda igual algo: un modelo no acepta una conversacion sin mensajes", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "openai",
      modelId: "gpt-x",
    });
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never);
    const { client } = fakeClient([]);

    await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      systemPrompt: "recordale la promo",
      trace: TRACE,
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as { messages: unknown[] };
    expect(call.messages.length).toBeGreaterThan(0);
  });

  it("el userPrompt del paso de secuencia va al final, despues del historial", async () => {
    vi.mocked(getWorkspaceModel).mockResolvedValue({
      ok: true,
      model: {} as never,
      provider: "openai",
      modelId: "gpt-x",
    });
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never);
    const { client } = fakeClient([{ direction: "inbound", text: "hola" }]);

    await generateAiReply(client, {
      workspaceId: WS,
      conversationId: CONV,
      userPrompt: "escribile por la promo",
      trace: TRACE,
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages.at(-1)).toEqual({
      role: "user",
      content: "escribile por la promo",
    });
  });
});
