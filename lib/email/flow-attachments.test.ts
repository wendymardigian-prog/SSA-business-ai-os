import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadEmailAttachments } from "./flow-attachments";
import { attachmentBudget, parseEmailAttachments, MAX_EMAIL_ATTACHMENT_BYTES } from "./attachment-limits";

function world(downloads: Record<string, number>) {
  const db = memoryDb({
    response_assets: [
      { id: "a1", workspace_id: "ws", kind: "file", name: "Propuesta.pdf", storage_path: "ws/library/a1.pdf", mime_type: "application/pdf", size_bytes: 10, deleted_at: null },
      { id: "a2", workspace_id: "ws", kind: "image", name: "Foto", storage_path: "ws/library/a2.png", mime_type: "image/png", size_bytes: 10, deleted_at: null },
      { id: "borrado", workspace_id: "ws", kind: "file", name: "Viejo", storage_path: "ws/library/x.pdf", mime_type: "application/pdf", size_bytes: 10, deleted_at: "2026-10-01" },
      { id: "ajeno", workspace_id: "otro", kind: "file", name: "Ajeno", storage_path: "otro/library/y.pdf", mime_type: "application/pdf", size_bytes: 10, deleted_at: null },
    ],
  });
  const download = vi.fn(async (path: string) => {
    const size = downloads[path];
    return size === undefined ? { data: null, error: { message: "no existe" } } : { data: new Blob([new Uint8Array(size)]), error: null };
  });
  (db.client as unknown as { storage: unknown }).storage = { from: () => ({ download }) };
  return { db, download };
}

describe("loadEmailAttachments", () => {
  it("baja cada archivo una vez, en base64 y con su extension; lo borrado o ajeno queda como faltante", async () => {
    const { db, download } = world({ "ws/library/a1.pdf": 3, "ws/library/a2.png": 2 });
    const out = await loadEmailAttachments(db.client, {
      workspaceId: "ws",
      refs: [{ assetId: "a1", name: "Propuesta.pdf" }, { assetId: "a2" }, { assetId: "borrado", name: "Viejo" }, { assetId: "ajeno", name: "Ajeno" }],
    });
    expect(out.files.map((f) => f.filename)).toEqual(["Propuesta.pdf", "Foto.png"]);
    expect(out.files[0].content).toBe(Buffer.from(new Uint8Array(3)).toString("base64"));
    expect(out.missing).toEqual(["Viejo", "Ajeno"]);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("lo que se pasa del tope total no se adjunta", async () => {
    const { db } = world({ "ws/library/a1.pdf": MAX_EMAIL_ATTACHMENT_BYTES, "ws/library/a2.png": 10 });
    const out = await loadEmailAttachments(db.client, { workspaceId: "ws", refs: [{ assetId: "a1" }, { assetId: "a2" }] });
    expect(out.files).toHaveLength(1);
    expect(out.missing).toEqual(["Foto"]);
  });
});

describe("los topes", () => {
  it("attachmentBudget", () => {
    expect(attachmentBudget([1, 2]).ok).toBe(true);
    expect(attachmentBudget([MAX_EMAIL_ATTACHMENT_BYTES, 1]).ok).toBe(false);
    expect(attachmentBudget(Array.from({ length: 11 }, () => 1)).problem).toMatch(/10/);
  });
  it("parseEmailAttachments saca basura y repetidos", () => {
    expect(parseEmailAttachments([{ assetId: "a" }, { assetId: "a" }, { nope: 1 }, null, "x"])).toEqual([{ assetId: "a" }]);
  });
});
