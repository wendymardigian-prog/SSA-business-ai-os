import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";

const run = vi.hoisted(() => ({
  setModel: vi.fn(),
  addEmbeddingUsage: vi.fn(),
  step: vi.fn().mockResolvedValue("s"),
  close: vi.fn().mockResolvedValue({ costUsd: 0, pricingMissing: [] }),
  runId: "run-1",
}));
const mocks = vi.hoisted(() => ({ openAiRun: vi.fn(), embed: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ openAiRun: mocks.openAiRun }));
vi.mock("./embeddings", () => ({ generateEmbeddings: mocks.embed }));
vi.mock("./index-document", () => ({ writeChunks: mocks.write }));

import { indexText } from "./index-text";

const input = (over: Record<string, unknown> = {}) => ({
  workspaceId: "ws1",
  title: "Llamada: Ana (9 de octubre de 2026)",
  tags: ["llamadas"],
  internalOnly: true,
  sourceFilename: "llamada-c1.md",
  sourceMime: "text/markdown",
  contentMd: "Ana: hola\nWendy: buenas",
  chunks: ["Ana: hola, esto es un pedazo largo de prueba", "Wendy: buenas, este es otro pedazo largo"],
  now: new Date("2026-10-10T12:00:00Z"),
  ...over,
});

function setup(updatedRows: Array<{ id: string }> = []) {
  return fakeDb({
    "knowledge_base:update": (c: DbCall) => ((c.values as { status?: string }).status === "processing" ? { data: updatedRows } : { data: null }),
    "knowledge_base:insert": { data: { id: "doc-new" } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openAiRun.mockResolvedValue(run);
  mocks.embed.mockResolvedValue({ ok: true, embeddings: [[0.1], [0.2]], model: "voyage-4-lite", totalTokens: 42 });
  mocks.write.mockResolvedValue(undefined);
});

describe("indexText", () => {
  it("crea el documento INTERNO, con su etiqueta, sin archivo, y lo deja listo", async () => {
    const db = setup();
    const r = await indexText(db.client, input());
    expect(r).toEqual({ documentId: "doc-new", status: "ready", chunks: 2 });
    const created = db.writesTo("knowledge_base").find((c) => c.op === "insert")!.values as Record<string, unknown>;
    expect(created).toMatchObject({
      workspace_id: "ws1",
      title: "Llamada: Ana (9 de octubre de 2026)",
      tags: ["llamadas"],
      internal_only: true,
      source_mime: "text/markdown",
      source_filename: "llamada-c1.md",
      source_file_path: null,
      status: "processing",
      content_md: "Ana: hola\nWendy: buenas",
    });
    const final = db.writesTo("knowledge_base").at(-1)!.values as Record<string, unknown>;
    expect(final).toMatchObject({ status: "ready", chunk_count: 2, embedding_model: "voyage-4-lite", error_detail: null });
  });

  it("escribe los pedazos con su indice y los embeddings, y registra el run kb_indexing con el costo", async () => {
    const db = setup();
    await indexText(db.client, input());
    expect(mocks.write).toHaveBeenCalledWith(db.client, expect.objectContaining({ documentId: "doc-new", workspaceId: "ws1", embeddings: [[0.1], [0.2]] }));
    expect(mocks.write.mock.calls[0][1].chunks.map((c: { index: number }) => c.index)).toEqual([0, 1]);
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "kb_indexing", trigger: "job", threadId: "doc-new" });
    expect(run.addEmbeddingUsage).toHaveBeenCalledWith({ provider: "voyage", model: "voyage-4-lite", tokens: 42 });
    expect(run.close).toHaveBeenCalledWith({ status: "completed" });
  });

  it("si ya habia un documento, lo reemplaza (mismo id) en vez de crear otro: queda uno solo", async () => {
    const db = setup([{ id: "doc-old" }]);
    const r = await indexText(db.client, input({ replaceDocumentId: "doc-old" }));
    expect(r.documentId).toBe("doc-old");
    expect(db.writesTo("knowledge_base").some((c) => c.op === "insert")).toBe(false);
    expect(mocks.write.mock.calls[0][1].documentId).toBe("doc-old");
  });

  it("si el documento a reemplazar ya no existe (se borro), crea uno nuevo", async () => {
    const db = setup([]);
    const r = await indexText(db.client, input({ replaceDocumentId: "doc-borrado" }));
    expect(r.documentId).toBe("doc-new");
  });

  it("sin Voyage conectado: el documento queda en error con el motivo, igual que uno subido", async () => {
    mocks.embed.mockResolvedValue({ ok: false, problem: "not_connected", message: "Conectá Voyage en Integraciones.", retryable: false });
    const db = setup();
    const r = await indexText(db.client, input());
    expect(r).toMatchObject({ documentId: "doc-new", status: "error", detail: "Conectá Voyage en Integraciones.", retryable: false });
    expect(db.writesTo("knowledge_base").at(-1)!.values).toMatchObject({ status: "error", error_detail: "Conectá Voyage en Integraciones.", chunk_count: 0 });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(run.close).toHaveBeenCalledWith(expect.objectContaining({ status: "error", statusDetail: "permanent" }));
  });

  it("un fallo transitorio de Voyage se marca como reintentable", async () => {
    mocks.embed.mockResolvedValue({ ok: false, problem: "rate_limited", message: "Voyage pidió esperar.", retryable: true });
    const r = await indexText(setup().client, input());
    expect(r).toMatchObject({ status: "error", retryable: true });
  });

  it("sin pedazos no gasta embeddings: error permanente", async () => {
    const r = await indexText(setup().client, input({ chunks: [] }));
    expect(r).toMatchObject({ status: "error", retryable: false });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
  });

  it("si ni siquiera se puede crear el documento, lo dice sin lanzar", async () => {
    const db = fakeDb({ "knowledge_base:insert": { error: { message: "boom" } } });
    expect(await indexText(db.client, input())).toMatchObject({ documentId: null, status: "error", retryable: true });
  });
});
