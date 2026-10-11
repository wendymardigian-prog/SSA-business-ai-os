import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock("@/lib/calls/summary-run", () => ({ runCallSummaryJob: run.job }));

import { handleCallSummary } from "./call-summary";

const ctx = (payload: unknown) => ({ supabase: { tag: "db" } as never, job: { id: "j", type: "call_summary", payload, attempts: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  run.job.mockResolvedValue({ outcome: "done" });
});

describe("handler call_summary", () => {
  it("resume la llamada del payload con el contador de reintentos y quien lo pidio", async () => {
    const payload = { callId: "c1", retry: 1, manual: true, requestedBy: "u1" };
    await handleCallSummary(ctx(payload));
    expect(run.job).toHaveBeenCalledWith({ db: { tag: "db" } }, payload);
  });
  it("sin callId no hace nada", async () => {
    await handleCallSummary(ctx({}));
    expect(run.job).not.toHaveBeenCalled();
  });
  it("lo inesperado se relanza para que la cola reintente", async () => {
    run.job.mockRejectedValue(new Error("db caida"));
    await expect(handleCallSummary(ctx({ callId: "c1" }))).rejects.toThrow("db caida");
  });
});
