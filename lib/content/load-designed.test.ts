import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadDesignedPieceIds } from "./load-designed";

const WS = "ws-1";

describe("loadDesignedPieceIds: las piezas con un diseño vinculado (F65)", () => {
  it("junta las piezas de los diseños vinculados y vivos del negocio", async () => {
    const db = memoryDb({
      designs: [
        { id: "d1", workspace_id: WS, content_post_id: "p1", archived_at: null },
        { id: "d2", workspace_id: WS, content_post_id: "p1", archived_at: null },
        { id: "d3", workspace_id: WS, content_post_id: "p2", archived_at: null },
        { id: "d4", workspace_id: WS, content_post_id: null, archived_at: null },
        { id: "d5", workspace_id: WS, content_post_id: "p3", archived_at: "2026-11-01T00:00:00Z" },
        { id: "d6", workspace_id: "otro", content_post_id: "p4", archived_at: null },
      ],
    });

    expect([...(await loadDesignedPieceIds(db.client, WS))].sort()).toEqual(["p1", "p2"]);
  });

  it("sin diseños, un conjunto vacío", async () => {
    expect((await loadDesignedPieceIds(memoryDb({ designs: [] }).client, WS)).size).toBe(0);
  });

  it("si la lectura falla no tumba el tablero: queda vacío y se loguea", async () => {
    const failing = {
      from: () => ({ select: () => ({ eq: () => ({ not: () => ({ is: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "XX", message: "caída" } }) }) }) }) }) }) }),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await loadDesignedPieceIds(failing as never, WS)).size).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
