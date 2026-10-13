/**
 * F24: miniaturas propias de los anuncios. `fetch` y el bucket se simulan; nada sale a internet.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const scheduled: Array<{ type: string; payload: unknown; runAt: Date; key?: string }> = [];
vi.mock("@/lib/scheduler", () => ({
  scheduleJob: async (_s: unknown, type: string, payload: unknown, runAt: Date, key?: string) => {
    scheduled.push({ type, payload, runAt, key });
    return { id: "job-1" };
  },
}));

const { downloadThumbnail, isSafeThumbnailUrl, retryDelayMinutes, runThumbnailBatch, thumbnailPath, THUMBNAIL_MAX_BYTES } = await import("./thumbnails");

const WS = "ws-1";
const ACC = "act_1";
const NOW = new Date("2026-10-13T12:00:00Z");

// 12+ bytes con la firma de cada formato.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
const HTML = new TextEncoder().encode("<!doctype html><html><body>no soy una imagen</body></html>");

const res = (body: Uint8Array, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) =>
  ({ ok: init.ok ?? true, status: init.status ?? 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), headers: new Headers(init.headers) }) as unknown as Response;

const ad = (id: string, over: Record<string, unknown> = {}) => ({
  id: `row-${id}`, workspace_id: WS, ad_account_id: ACC, ad_id: id,
  thumbnail_source_url: `https://scontent.fbcdn.net/${id}.jpg`, thumbnail_path: null, thumbnail_attempts: 0,
  created_at: "2026-10-01T00:00:00Z", ...over,
});

beforeEach(() => {
  scheduled.length = 0;
});

describe("isSafeThumbnailUrl", () => {
  it("solo https y nada local", () => {
    expect(isSafeThumbnailUrl("https://scontent.fbcdn.net/a.jpg")).toBe(true);
    expect(isSafeThumbnailUrl("http://scontent.fbcdn.net/a.jpg")).toBe(false);
    expect(isSafeThumbnailUrl("https://localhost/a.jpg")).toBe(false);
    expect(isSafeThumbnailUrl("https://127.0.0.1/a.jpg")).toBe(false);
    expect(isSafeThumbnailUrl("https://[::1]/a.jpg")).toBe(false);
    expect(isSafeThumbnailUrl("no es una url")).toBe(false);
  });
});

describe("downloadThumbnail", () => {
  it("un PNG valido se acepta", async () => {
    const r = await downloadThumbnail("https://x.fbcdn.net/a", vi.fn(async () => res(PNG)));
    expect(r).toMatchObject({ ok: true, mime: "image/png" });
  });
  it("un HTML disfrazado de imagen se RECHAZA (aunque diga image/png)", async () => {
    const r = await downloadThumbnail("https://x.fbcdn.net/a", vi.fn(async () => res(HTML, { headers: { "content-type": "image/png" } })));
    expect(r).toEqual({ ok: false, reason: "not_image" });
  });
  it("un 404, una imagen de mas de 2 MB y una caida de red no lanzan", async () => {
    expect(await downloadThumbnail("https://x.fbcdn.net/a", vi.fn(async () => res(PNG, { ok: false, status: 404 })))).toEqual({ ok: false, reason: "http" });
    expect(await downloadThumbnail("https://x.fbcdn.net/a", vi.fn(async () => res(PNG, { headers: { "content-length": String(THUMBNAIL_MAX_BYTES + 1) } })))).toEqual({ ok: false, reason: "too_big" });
    expect(await downloadThumbnail("https://x.fbcdn.net/a", vi.fn(async () => { throw new Error("reset"); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: "network" });
  });
});

describe("thumbnailPath / retryDelayMinutes", () => {
  it("el primer segmento es el workspace", () => {
    expect(thumbnailPath(WS, "123", "image/png")).toBe("ws-1/123.png");
    expect(thumbnailPath(WS, "../../x", "image/jpeg")).toBe("ws-1/x.jpg");
  });
  it("1 min, 5 min y despues no hay mas", () => {
    expect([1, 2, 3].map(retryDelayMinutes)).toEqual([1, 5, null]);
  });
});

describe("runThumbnailBatch", () => {
  it("con un PNG sube a ad-creatives y escribe thumbnail_path", async () => {
    const db = memoryDb({ meta_ads: [ad("a1")] });
    const upload = vi.fn(async () => ({ error: null }));
    const r = await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl: vi.fn(async () => res(PNG)), upload });
    expect(r).toMatchObject({ saved: 1, failed: 0 });
    expect(upload).toHaveBeenCalledWith("ws-1/a1.png", expect.any(Uint8Array), "image/png");
    expect(db.rows("meta_ads")[0]).toMatchObject({ thumbnail_path: "ws-1/a1.png" });
    expect(scheduled).toHaveLength(0);
  });

  it("con un 404 suma un intento, reagenda a 1 minuto y NO lanza", async () => {
    const db = memoryDb({ meta_ads: [ad("a1")] });
    const upload = vi.fn();
    const r = await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl: vi.fn(async () => res(PNG, { ok: false, status: 404 })), upload });
    expect(r).toMatchObject({ saved: 0, failed: 1 });
    expect(upload).not.toHaveBeenCalled();
    expect(db.rows("meta_ads")[0]).toMatchObject({ thumbnail_attempts: 1, thumbnail_path: null });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].runAt.getTime()).toBe(NOW.getTime() + 60_000);
    expect(scheduled[0].type).toBe("meta_ad_thumbnails");
  });

  it("con un HTML disfrazado no sube nada", async () => {
    const db = memoryDb({ meta_ads: [ad("a1")] });
    const upload = vi.fn();
    await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl: vi.fn(async () => res(HTML)), upload });
    expect(upload).not.toHaveBeenCalled();
    expect(db.rows("meta_ads")[0]).toMatchObject({ thumbnail_attempts: 1, thumbnail_path: null });
  });

  it("un fallo de subida cuenta como intento fallido", async () => {
    const db = memoryDb({ meta_ads: [ad("a1")] });
    const r = await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl: vi.fn(async () => res(PNG)), upload: async () => ({ error: "bucket lleno" }) });
    expect(r.failed).toBe(1);
    expect(db.rows("meta_ads")[0]).toMatchObject({ thumbnail_attempts: 1, thumbnail_path: null });
  });

  it("no toca los anuncios con 3 intentos, los que ya tienen miniatura ni los de otra cuenta", async () => {
    const db = memoryDb({
      meta_ads: [ad("a1", { thumbnail_attempts: 3 }), ad("a2", { thumbnail_path: "ws-1/a2.png" }), ad("a3", { ad_account_id: "act_2" }), ad("a4", { thumbnail_source_url: null })],
    });
    const fetchImpl = vi.fn(async () => res(PNG));
    const r = await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl, upload: async () => ({ error: null }) });
    expect(r.processed).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("procesa 25 por corrida y reagenda si quedan mas", async () => {
    const db = memoryDb({ meta_ads: Array.from({ length: 30 }, (_, i) => ad(`a${i}`)) });
    const r = await runThumbnailBatch(db.client, { workspaceId: WS, adAccountId: ACC, now: NOW }, { fetchImpl: vi.fn(async () => res(PNG)), upload: async () => ({ error: null }) });
    expect(r).toMatchObject({ processed: 25, saved: 25, more: true });
    expect(scheduled).toHaveLength(1);
  });
});
