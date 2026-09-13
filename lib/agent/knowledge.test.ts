import { describe, it, expect, vi, beforeEach } from "vitest";

const embedQuery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/knowledge/embeddings", () => ({ embedQuery }));

import { searchKnowledge } from "./knowledge";
import { buildToolSet } from "./tools/build";
import { toAgentConfig } from "./config";
import { memoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * Acceso del agente a la base de conocimiento (F27).
 *
 * El filtro vive en el SQL (match_knowledge_chunks_filtered, 00062) y se
 * verifica contra la base real en scripts/verify-rls.mjs. Aca se fija el
 * contrato del lado de la app: que SIEMPRE se pide excluir lo interno, que se
 * pasan los tags del agente, que los pasos del run guardan los fragmentos, y
 * que el costo del embedding entra al run.
 */

const DOCS = [
  { chunk_id: "ch-publico", document_id: "doc-precios", document_title: "Precios", tags: ["ventas"], internal_only: false, content: "El plan cuesta 100" },
  { chunk_id: "ch-interno", document_id: "doc-margenes", document_title: "Margenes internos", tags: ["ventas"], internal_only: true, content: "Margen 70%" },
  { chunk_id: "ch-otro-tag", document_id: "doc-rrhh", document_title: "RRHH", tags: ["equipo"], internal_only: false, content: "Vacaciones" },
];

function fakeRun() {
  const steps: Array<Record<string, unknown>> = [];
  const embeddings: Array<Record<string, unknown>> = [];
  const run = {
    runId: "run-1",
    setModel: vi.fn(),
    addStepUsage: vi.fn(),
    setFinalUsage: vi.fn(),
    addEmbeddingUsage: (u: Record<string, unknown>) => embeddings.push(u),
    step: async (s: Record<string, unknown>) => (steps.push(s), "step"),
    close: vi.fn(),
  } as unknown as AiRunHandle;
  return { run, steps, embeddings };
}

/** La RPC en memoria replica la semantica del WHERE de la 00062. */
function db() {
  return memoryDb(
    {},
    {
      rpc: {
        match_knowledge_chunks_filtered: (args) =>
          DOCS.filter(
            (d) =>
              (args.p_include_internal || !d.internal_only) &&
              (!args.p_tags || (args.p_tags as string[]).some((t) => d.tags.includes(t))),
          ),
      },
    },
  );
}

beforeEach(() => {
  embedQuery.mockReset();
  embedQuery.mockResolvedValue({ ok: true, embedding: [0.1, 0.2], model: "voyage-4-lite", totalTokens: 12 });
});

describe("busqueda filtrada en la base de conocimiento", () => {
  it("siempre pide excluir los documentos internos, y un documento internal_only no llega al resultado", async () => {
    const d = db();
    const { run, steps } = fakeRun();
    const result = await searchKnowledge(d.client, { workspaceId: "ws-1", query: "cuanto sale", tags: [], matchCount: 5, minSimilarity: 0.3, run });

    expect(d.rpcCalls[0].args.p_include_internal).toBe(false);
    expect(result.ok && result.chunks.map((c) => c.chunkId)).not.toContain("ch-interno");
    expect(steps[0].kbChunkIds).not.toContain("ch-interno");
  });

  it("con tags configurados, solo trae documentos de esos tags", async () => {
    const d = db();
    const { run } = fakeRun();
    const result = await searchKnowledge(d.client, { workspaceId: "ws-1", query: "x", tags: ["ventas"], matchCount: 5, minSimilarity: 0.3, run });

    expect(d.rpcCalls[0].args.p_tags).toEqual(["ventas"]);
    expect(result.ok && result.chunks.map((c) => c.chunkId)).toEqual(["ch-publico"]);
  });

  it("sin tags configurados pasa null: toda la base salvo lo interno", async () => {
    const d = db();
    const { run } = fakeRun();
    await searchKnowledge(d.client, { workspaceId: "ws-1", query: "x", tags: [], matchCount: 5, minSimilarity: 0.3, run });
    expect(d.rpcCalls[0].args.p_tags).toBeNull();
  });

  it("el paso del run guarda documento + fragmento, y el embedding de la consulta entra al costo del run", async () => {
    const d = db();
    const { run, steps, embeddings } = fakeRun();
    await searchKnowledge(d.client, { workspaceId: "ws-1", query: "precios", tags: [], matchCount: 5, minSimilarity: 0.3, run });

    expect(steps[0]).toMatchObject({ kind: "kb_search", kbChunkIds: ["ch-publico", "ch-otro-tag"] });
    expect(JSON.stringify(steps[0].output)).toContain("doc-precios");
    expect(embeddings).toEqual([{ provider: "voyage", model: "voyage-4-lite", tokens: 12 }]);
  });
});

describe("la herramienta de buscar en el turno", () => {
  const ctx = (knowledgeEnabled: boolean, over: Partial<Parameters<typeof agentRow>[0]> = {}) => ({
    supabase: db().client,
    agent: toAgentConfig(agentRow({ knowledge_enabled: knowledgeEnabled, ...over })),
    workspaceId: "ws-1",
    conversationId: "cv-1",
    contactId: "c-1",
    channelId: "ch-1",
    run: fakeRun().run,
    nonce: "abcd1234",
  });

  it("con la KB apagada no existe en la caja de herramientas", async () => {
    const { tools } = await buildToolSet(ctx(false));
    expect(Object.keys(tools)).toEqual(["derivar_a_humano"]);
  });

  it("una busqueda sin resultados no deriva sola: le devuelve al agente que no encontro nada", async () => {
    embedQuery.mockResolvedValue({ ok: true, embedding: [0], model: "voyage-4-lite", totalTokens: 1 });
    const c = ctx(true, { knowledge_tags: ["inexistente"] });
    const { tools, state } = await buildToolSet(c);
    const out = await (tools.buscar_en_conocimiento as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
      { consulta: "algo" },
      { toolCallId: "t", messages: [] },
    );
    expect(out).toContain("No encontre nada");
    expect(state.escalated).toBe(false);
  });

  it("lo que devuelve la KB viaja delimitado como dato, no como instruccion", async () => {
    const { tools } = await buildToolSet(ctx(true));
    const out = await (tools.buscar_en_conocimiento as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
      { consulta: "precios" },
      { toolCallId: "t", messages: [] },
    );
    expect(out).toMatch(/^<<<conocimiento abcd1234>>>/);
  });

  it("la salida de emergencia no se pierde por una config rota: corre con sus defaults", async () => {
    const { tools } = await buildToolSet(ctx(false, { tools_config: { derivar_a_humano: { reopenConversation: "si" } } as never }));
    expect(Object.keys(tools)).toEqual(["derivar_a_humano"]);
  });
});
