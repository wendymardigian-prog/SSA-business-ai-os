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

  it("la miniatura de un video entra junto con su archivo", () => {
    const plans = planAssetStorageCleanup({
      assets: [{ id: "v-1", storage_path: "ws-1/library/v-1.mp4", preview_path: "ws-1/library/v-1-preview.jpg" }],
    });
    expect(plans.map((p) => p.path)).toEqual(["ws-1/library/v-1.mp4", "ws-1/library/v-1-preview.jpg"]);
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

  it("cubre los cuatro tipos con archivo, y la miniatura de un video (banca v2, F13)", async () => {
    const old = daysAgo(ASSET_ORPHAN_RETENTION_DAYS + 1);
    const { memory, remove } = db([
      row({ id: "a-1", kind: "audio", storage_path: "ws-1/library/a.m4a", deleted_at: old }),
      row({ id: "v-1", kind: "video", storage_path: "ws-1/library/v.mp4", preview_path: "ws-1/library/v-preview.jpg", deleted_at: old }),
      row({ id: "i-1", kind: "image", storage_path: "ws-1/library/i.png", deleted_at: old }),
      row({ id: "f-1", kind: "file", storage_path: "ws-1/library/f.pdf", deleted_at: old }),
      { id: "l-1", workspace_id: "ws-1", kind: "link", name: "X", storage_path: null, url: "https://x.com", deleted_at: old },
    ]);
    const result = await cleanupOrphanedAssetFiles(memory.client, NOW);
    expect(result).toEqual({ attempted: 5, failed: 0 });
    const removed = remove.mock.calls.map((call) => (call as unknown as [string[]])[0][0]).sort();
    expect(removed).toEqual([
      "ws-1/library/a.m4a",
      "ws-1/library/f.pdf",
      "ws-1/library/i.png",
      "ws-1/library/v-preview.jpg",
      "ws-1/library/v.mp4",
    ]);
  });
});
