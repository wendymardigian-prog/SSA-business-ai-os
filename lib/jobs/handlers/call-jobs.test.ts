import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ classify: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/calls/classify-run", () => ({ runCallClassification: run.classify }));
vi.mock("@/lib/calls/analyze-run", () => ({ runCallAnalysisJob: run.analyze }));

import { handleCallClassify } from "./call-classify";
import { handleCallAnalyze } from "./call-analyze";

const ctx = (payload: unknown) => ({ supabase: { tag: "db" } as never, job: { id: "j", type: "x", payload, attempts: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  run.classify.mockResolvedValue({ outcome: "ai" });
  run.analyze.mockResolvedValue({ outcome: "analyzed" });
});

describe("handler call_classify", () => {
  it("clasifica la llamada del payload con el contador de reintentos", async () => {
    await handleCallClassify(ctx({ callId: "c1", retry: 2 }));
    expect(run.classify).toHaveBeenCalledWith({ db: { tag: "db" } }, "c1", 2);
  });
  it("sin callId no hace nada y no lanza", async () => {
    await handleCallClassify(ctx({}));
    expect(run.classify).not.toHaveBeenCalled();
  });
  it("lo inesperado (la base) se relanza para que la cola reintente", async () => {
    run.classify.mockRejectedValue(new Error("db caida"));
    await expect(handleCallClassify(ctx({ callId: "c1" }))).rejects.toThrow("db caida");
  });
});

describe("handler call_analyze", () => {
  it("analiza con el payload entero (manual, quien lo pidio, contexto)", async () => {
    const payload = { callId: "c1", manual: true, requestedBy: "u1", extraContext: "x" };
    await handleCallAnalyze(ctx(payload));
    expect(run.analyze).toHaveBeenCalledWith({ db: { tag: "db" } }, payload);
  });
  it("sin callId no hace nada", async () => {
    await handleCallAnalyze(ctx({}));
    expect(run.analyze).not.toHaveBeenCalled();
  });
});
