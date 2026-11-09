// @plantilla-quitar(servicios)
import { describe, expect, it, vi } from "vitest";
import { countPendingSubmissions, pendingReviewTotal } from "./review-count";
import { matchesReviewFilter } from "@/lib/program/review";

function fakeService(result: { count: number | null; error: { code: string } | null }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return m === "or" ? Promise.resolve(result) : chain;
    };
  }
  return { client: { from: vi.fn(() => chain) }, calls };
}

describe("countPendingSubmissions", () => {
  it("cuenta solo las entregas del portal de este negocio sin revisar", async () => {
    const { client, calls } = fakeService({ count: 4, error: null });
    expect(await countPendingSubmissions(client as never, "ws-1")).toBe(4);
    expect(calls).toContainEqual(["eq", ["workspace_id", "ws-1"]]);
    expect(calls).toContainEqual(["eq", ["context", "portal"]]);
    expect(calls).toContainEqual(["eq", ["forms.type", "activity"]]);
    expect(calls).toContainEqual(["or", ["review_status.is.null,review_status.eq.pending"]]);
  });

  it("un error cuenta 0 y no lanza", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeService({ count: null, error: { code: "57014" } });
    expect(await countPendingSubmissions(client as never, "ws-1")).toBe(0);
    spy.mockRestore();
  });

  it("usa la misma regla que el filtro «Pendientes»", () => {
    // Si cambia la regla del filtro, este contador tiene que cambiar con ella.
    const base = { grade: null, formType: "activity" } as never;
    expect(matchesReviewFilter({ ...(base as object), reviewStatus: null } as never, "pending")).toBe(true);
    expect(matchesReviewFilter({ ...(base as object), reviewStatus: "pending" } as never, "pending")).toBe(true);
    expect(matchesReviewFilter({ ...(base as object), reviewStatus: "reviewed" } as never, "pending")).toBe(false);
    expect(matchesReviewFilter({ ...(base as object), reviewStatus: "graded" } as never, "pending")).toBe(false);
    expect(matchesReviewFilter({ ...(base as object), reviewStatus: "needs_changes" } as never, "pending")).toBe(false);
    expect(matchesReviewFilter({ ...(base as object), formType: "quiz", reviewStatus: null } as never, "pending")).toBe(false);
  });
});

describe("pendingReviewTotal", () => {
  it("suma entregas y comentarios sin contestar", () => {
    expect(pendingReviewTotal(2, [{ id: "a", name: "A", unanswered: 3 }])).toBe(5);
    expect(pendingReviewTotal(2, null)).toBe(2);
    expect(pendingReviewTotal(0, [])).toBe(0);
  });
});
