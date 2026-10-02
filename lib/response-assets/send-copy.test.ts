import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { copyAssetToChat } from "./send-copy";

const WS = "ws-1";
const CONV = "conv-1";

function db(rows: Array<Record<string, unknown>> = []) {
  const memory = memoryDb({ response_assets: rows });
  const copy = vi.fn(async () => ({ data: { path: "copied" }, error: null }));
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({ copy }),
  };
  return { memory, copy };
}

function audioRow(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    workspace_id: WS,
    kind: "audio",
    name: "Precio",
    storage_path: `${WS}/library/a-1.m4a`,
    mime_type: "audio/mp4",
    duration_seconds: 8,
    deleted_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("copyAssetToChat", () => {
  it("copia el archivo a <ws>/<conversationId>/ y devuelve el path nuevo", async () => {
    const { memory, copy } = db([audioRow()]);

    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "a-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.copy.storagePath).toMatch(new RegExp(`^${WS}/${CONV}/library-[0-9a-f-]+\\.m4a$`));
      expect(result.copy.mime).toBe("audio/mp4");
      expect(result.copy.filename).toBe("Precio.m4a");
      expect(result.copy.durationSeconds).toBe(8);
    }
    expect(copy).toHaveBeenCalledWith(`${WS}/library/a-1.m4a`, expect.stringMatching(new RegExp(`^${WS}/${CONV}/library-`)));
  });

  it("un id que no existe no se puede copiar", async () => {
    const { memory } = db([]);
    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "nope" });
    expect(result).toEqual({ ok: false, error: "Ese audio ya no está disponible" });
  });

  it("un recurso kind='text' no tiene archivo que copiar", async () => {
    const { memory } = db([{ id: "t-1", workspace_id: WS, kind: "text", name: "X", content: "c", storage_path: null, mime_type: null, deleted_at: null }]);
    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "t-1" });
    expect(result).toEqual({ ok: false, error: "Ese audio ya no está disponible" });
  });

  it("un audio borrado no se puede copiar", async () => {
    const { memory } = db([audioRow({ deleted_at: new Date().toISOString() })]);
    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "a-1" });
    expect(result).toEqual({ ok: false, error: "Ese audio ya no está disponible" });
  });

  it("un asset de OTRO workspace no se puede copiar", async () => {
    const { memory } = db([audioRow({ workspace_id: "otro-ws" })]);
    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "a-1" });
    expect(result).toEqual({ ok: false, error: "Ese audio ya no está disponible" });
  });

  it("si Storage falla al copiar, devuelve un error legible", async () => {
    const { memory } = db([audioRow()]);
    (memory.client as unknown as { storage: unknown }).storage = {
      from: () => ({ copy: async () => ({ data: null, error: { message: "boom" } }) }),
    };
    const result = await copyAssetToChat(memory.client, { workspaceId: WS, conversationId: CONV, assetId: "a-1" });
    expect(result).toEqual({ ok: false, error: "No pude preparar el audio para mandarlo" });
  });
});
