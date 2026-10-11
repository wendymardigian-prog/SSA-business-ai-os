import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ indexText: vi.fn() }));
vi.mock("@/lib/knowledge/index-text", () => ({ indexText: mocks.indexText }));

import { chunkText, knowledgeEligibility, runCallKnowledgeJob } from "./knowledge-run";

const transcript = [
  { timestamp: "00:00:05", speaker: { display_name: "Ana" }, text: "No me llegan clientes y estoy desesperada, llevo tres meses así." },
  { timestamp: "00:00:20", speaker: { display_name: "Wendy" }, text: "Contame un poco más de tu situación actual, así te oriento mejor." },
];
const callRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  workspace_id: "ws1",
  title: "Llamada con Ana",
  call_type: "cierre",
  recorded_at: "2026-10-09T15:00:00Z",
  transcript,
  knowledge_document_id: null,
  ...over,
});
const setup = (call: Record<string, unknown> | null = callRow()) =>
  fakeDb({ "calls:select": { data: call }, "workspaces:select": { data: { timezone: "America/Costa_Rica" } }, "calls:update": { data: [{ id: "c1" }] } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.indexText.mockResolvedValue({ documentId: "doc1", status: "ready", chunks: 1 });
});

describe("knowledgeEligibility", () => {
  it("solo cierre, seguimiento y triaje con transcripcion; nunca equipo", () => {
    for (const t of ["cierre", "seguimiento", "triaje"]) expect(knowledgeEligibility({ call_type: t, transcript }).ok).toBe(true);
    for (const t of ["equipo", "cliente", "clase", "no_show", "otra", null]) expect(knowledgeEligibility({ call_type: t, transcript }).ok).toBe(false);
    expect(knowledgeEligibility({ call_type: "cierre", transcript: [] }).ok).toBe(false);
  });
});

describe("chunkText", () => {
  it("lleva el minuto adelante, o el rango si hay dos", () => {
    expect(chunkText({ content: "Ana: hola", speaker: "Ana", tsStart: "00:01", tsEnd: "00:05", heading: null })).toBe("[00:01 – 00:05]\nAna: hola");
    expect(chunkText({ content: "Ana: hola", speaker: "Ana", tsStart: "00:01", tsEnd: "00:01", heading: null })).toBe("[00:01]\nAna: hola");
    expect(chunkText({ content: "Ana: hola", speaker: "Ana", tsStart: null, tsEnd: null, heading: null })).toBe("Ana: hola");
  });
});

describe("runCallKnowledgeJob", () => {
  it("crea el documento INTERNO con la etiqueta llamadas, el titulo, el archivo .md y la transcripcion por turnos", async () => {
    const db = setup();
    const r = await runCallKnowledgeJob({ db: db.client }, { callId: "c1", requestedBy: "u1" });
    expect(r).toEqual({ outcome: "ready", documentId: "doc1", chunks: 1 });
    const arg = mocks.indexText.mock.calls[0][1];
    expect(arg).toMatchObject({
      workspaceId: "ws1",
      title: "Llamada: Llamada con Ana (9 de octubre de 2026)",
      tags: ["llamadas"],
      internalOnly: true,
      sourceFilename: "llamada-c1.md",
      sourceMime: "text/markdown",
      replaceDocumentId: null,
      createdBy: "u1",
    });
    expect(arg.contentMd).toBe("Ana: No me llegan clientes y estoy desesperada, llevo tres meses así.\nWendy: Contame un poco más de tu situación actual, así te oriento mejor.");
    expect(arg.chunks[0]).toMatch(/^\[00:00:05 – 00:00:20\]\nAna: /);
  });

  it("guarda el id del documento en la llamada", async () => {
    const db = setup();
    await runCallKnowledgeJob({ db: db.client }, { callId: "c1" });
    expect(db.writesTo("calls")[0].values).toEqual({ knowledge_document_id: "doc1" });
  });

  it("mandar dos veces la misma llamada deja UN documento: el segundo reemplaza al primero", async () => {
    const db = setup(callRow({ knowledge_document_id: "doc1" }));
    await runCallKnowledgeJob({ db: db.client }, { callId: "c1" });
    expect(mocks.indexText.mock.calls[0][1].replaceDocumentId).toBe("doc1");
    // el id no cambio: no hace falta reescribir la llamada
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("una llamada de equipo NO crea documento", async () => {
    const db = setup(callRow({ call_type: "equipo" }));
    expect(await runCallKnowledgeJob({ db: db.client }, { callId: "c1" })).toEqual({ outcome: "not_eligible" });
    expect(mocks.indexText).not.toHaveBeenCalled();
  });

  it("una llamada que no existe no hace nada", async () => {
    expect(await runCallKnowledgeJob({ db: setup(null).client }, { callId: "x" })).toEqual({ outcome: "gone" });
  });

  it("sin Voyage el documento queda en error con el motivo y la llamada apunta a el", async () => {
    mocks.indexText.mockResolvedValue({ documentId: "doc2", status: "error", chunks: 0, detail: "Conectá Voyage en Integraciones.", retryable: false });
    const db = setup();
    const r = await runCallKnowledgeJob({ db: db.client }, { callId: "c1" });
    expect(r).toEqual({ outcome: "error", documentId: "doc2", detail: "Conectá Voyage en Integraciones.", retryable: false });
    expect(db.writesTo("calls")[0].values).toEqual({ knowledge_document_id: "doc2" });
  });
});
