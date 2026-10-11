import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock("@/lib/calls/knowledge-run", () => ({ runCallKnowledgeJob: run.job }));

import { handleCallIndexKnowledge } from "./call-index-knowledge";

const ctx = (payload: unknown) => ({ supabase: { tag: "db" } as never, job: { id: "j", type: "call_index_knowledge", payload, attempts: 0 } });

beforeEach(() => vi.clearAllMocks());

describe("handler call_index_knowledge", () => {
  it("manda la llamada del payload", async () => {
    run.job.mockResolvedValue({ outcome: "ready", documentId: "d", chunks: 3 });
    await handleCallIndexKnowledge(ctx({ callId: "c1", requestedBy: "u1" }));
    expect(run.job).toHaveBeenCalledWith({ db: { tag: "db" } }, { callId: "c1", requestedBy: "u1" });
  });
  it("un fallo permanente (Voyage sin conectar) NO lanza: el documento queda en error y el job termina", async () => {
    run.job.mockResolvedValue({ outcome: "error", documentId: "d", detail: "Conectá Voyage", retryable: false });
    await expect(handleCallIndexKnowledge(ctx({ callId: "c1" }))).resolves.toBeUndefined();
  });
  it("un fallo transitorio lanza para que el runner reintente", async () => {
    run.job.mockResolvedValue({ outcome: "error", documentId: "d", detail: "429", retryable: true });
    await expect(handleCallIndexKnowledge(ctx({ callId: "c1" }))).rejects.toThrow("429");
  });
  it("sin callId no hace nada", async () => {
    await handleCallIndexKnowledge(ctx({}));
    expect(run.job).not.toHaveBeenCalled();
  });
});
