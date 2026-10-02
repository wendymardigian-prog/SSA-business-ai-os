import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { planAssetStorageCleanup, cleanupOrphanedAssetFiles, ASSET_ORPHAN_RETENTION_DAYS } from "./cleanup";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("planAssetStorageCleanup", () => {
  it("incluye los que todavia tienen storage_path", () => {
    const plans = planAssetStorageCleanup({ assets: [{ id: "a-1", storage_path: "ws-1/library/a-1.m4a" }] });
    expect(plans).toEqual([{ assetId: "a-1", path: "ws-1/library/a-1.m4a" }]);
  });

  it("un storage_path ya en null (borrado a tiempo) no entra", () => {
    const plans = planAssetStorageCleanup({ assets: [{ id: "a-1", storage_path: null }] });
    expect(plans).toEqual([]);
  });
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    workspace_id: "ws-1",
    kind: "audio",
    name: "X",
    storage_path: "ws-1/library/a-1.m4a",
    deleted_at: daysAgo(30),
    ...over,
  };
}

function db(rows: Array<Record<string, unknown>> = [row()]) {
  const memory = memoryDb({ response_assets: rows });
  const remove = vi.fn(async () => ({ error: null }));
  (memory.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };
  return { memory, remove };
}

describe("cleanupOrphanedAssetFiles", () => {
  it("borra el archivo de un audio dado de baja hace mas de 28 dias", async () => {
    const { memory, remove } = db([row({ deleted_at: daysAgo(ASSET_ORPHAN_RETENTION_DAYS + 1) })]);
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 1, failed: 0 });
    expect(remove).toHaveBeenCalledWith(["ws-1/library/a-1.m4a"]);
  });

  it("uno dado de baja hace poco todavia no entra (lo maneja el borrado inmediato)", async () => {
    const { memory, remove } = db([row({ deleted_at: daysAgo(2) })]);
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("un recurso vivo (no borrado) nunca entra", async () => {
    const { memory, remove } = db([row({ deleted_at: null })]);
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("un kind='text' nunca entra: no tiene archivo", async () => {
    const { memory, remove } = db([
      { id: "t-1", workspace_id: "ws-1", kind: "text", name: "X", storage_path: null, deleted_at: daysAgo(100) },
    ]);
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("un fallo de Storage se cuenta, pero no explota: mañana se reintenta", async () => {
    const { memory, remove: _unused } = db([row({ deleted_at: daysAgo(ASSET_ORPHAN_RETENTION_DAYS + 1) })]);
    (memory.client as unknown as { storage: unknown }).storage = {
      from: () => ({ remove: vi.fn(async () => ({ error: { message: "boom" } })) }),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 1, failed: 1 });
  });
});
