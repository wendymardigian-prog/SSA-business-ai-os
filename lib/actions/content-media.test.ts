/**
 * F92: la biblioteca de archivos de una pieza.
 *
 * Quitar un archivo lo saca tambien de las redes que lo usan, y borrarlo del
 * bucket depende de si la pieza ya salio. Subir uno le da su id y valida lo
 * que manda el navegador.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";

let db: MemoryDb;
const removeFromBucket = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "user-1" },
    workspace: { id: WS },
    role: "admin",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: db.client.from.bind(db.client),
    storage: { from: () => ({ remove: removeFromBucket }) },
  }),
}));

const { attachMedia, removeMedia } = await import("./content-media");

const entry = (id: string, kind: "image" | "video" = "image", withId = true) => ({
  ...(withId ? { id } : {}),
  storage_path: `${WS}/${POST}/${id}.${kind === "video" ? "mp4" : "jpg"}`,
  mime_type: kind === "video" ? "video/mp4" : "image/jpeg",
  kind,
  size_bytes: 1000,
});

function seed(over: { status?: string; media?: unknown[]; networks?: unknown[] } = {}) {
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        status: over.status ?? "draft",
        media: over.media ?? [entry("a"), entry("b"), entry("c"), entry("v", "video")],
        networks: over.networks ?? [
          { platform: "instagram", format: "carousel", files: ["a", "b", "c"] },
          { platform: "tiktok", format: "video", files: ["v"] },
          { platform: "threads", format: "carousel", files: ["c", "a"] },
        ],
      },
      { id: "ajena", workspace_id: "otro-ws", status: "draft", media: [entry("x")], networks: [] },
    ],
  });
}

beforeEach(() => {
  removeFromBucket.mockClear();
  seed();
});

describe("quitar un archivo de la biblioteca (F92)", () => {
  it("CRITERIO: si una red lo usa, se lo saca tambien, y se dice cuales eran", async () => {
    const result = await removeMedia({ postId: POST, fileId: "a" });

    expect(result).toEqual({ ok: true, data: { removedFrom: ["instagram", "threads"] } });

    const networks = db.rows("content_posts")[0].networks as Array<{ platform: string; files: string[] }>;
    expect(networks.find((n) => n.platform === "instagram")?.files).toEqual(["b", "c"]);
    expect(networks.find((n) => n.platform === "threads")?.files).toEqual(["c"]);
    expect(networks.find((n) => n.platform === "tiktok")?.files).toEqual(["v"]);
  });

  it("sale de la biblioteca", async () => {
    await removeMedia({ postId: POST, fileId: "a" });

    const ids = (db.rows("content_posts")[0].media as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(["b", "c", "v"]);
  });

  it("CRITERIO: en una pieza NO publicada se borra del bucket", async () => {
    await removeMedia({ postId: POST, fileId: "a" });

    expect(removeFromBucket).toHaveBeenCalledWith([`${WS}/${POST}/a.jpg`]);
  });

  it("en una pieza ya publicada se conserva en el bucket y queda marcado", async () => {
    seed({ status: "published" });

    const result = await removeMedia({ postId: POST, fileId: "a" });

    expect(result.ok).toBe(true);
    expect(removeFromBucket).not.toHaveBeenCalled();
    const marcado = (db.rows("content_posts")[0].media as Array<{ id: string; deleted_at?: string }>).find((m) => m.id === "a");
    expect(marcado?.deleted_at).toBeTruthy();
  });

  it("un archivo que ninguna red usa se quita sin tocar las redes", async () => {
    seed({ networks: [{ platform: "instagram", format: "image", files: ["b"] }] });

    const result = await removeMedia({ postId: POST, fileId: "a" });

    expect(result).toEqual({ ok: true, data: { removedFrom: [] } });
    expect(db.rows("content_posts")[0].networks).toEqual([{ platform: "instagram", format: "image", files: ["b"] }]);
  });

  it("los archivos de antes de F92 (sin id) se quitan por el id deducido, y quedan con id", async () => {
    seed({
      media: [entry("vieja", "image", false), entry("b")],
      networks: [{ platform: "instagram", format: "image", files: ["vieja"] }],
    });

    const result = await removeMedia({ postId: POST, fileId: "vieja" });

    expect(result).toEqual({ ok: true, data: { removedFrom: ["instagram"] } });
    // El que queda ya tiene id guardado.
    expect((db.rows("content_posts")[0].media as Array<{ id: string }>)[0].id).toBe("b");
  });

  it("un archivo que no esta, o ya borrado, dice que ya no esta", async () => {
    expect((await removeMedia({ postId: POST, fileId: "nada" })).ok).toBe(false);

    seed({ media: [{ ...entry("a"), deleted_at: "2026-10-01T00:00:00Z" }] });
    expect((await removeMedia({ postId: POST, fileId: "a" })).ok).toBe(false);
  });

  it("una pieza de otro workspace no se toca", async () => {
    const result = await removeMedia({ postId: "ajena", fileId: "x" });

    expect(result.ok).toBe(false);
    expect(removeFromBucket).not.toHaveBeenCalled();
  });

  it("si el bucket falla, la pieza ya quedo bien: no se deshace", async () => {
    removeFromBucket.mockResolvedValueOnce({ error: { message: "boom" } });

    const result = await removeMedia({ postId: POST, fileId: "a" });

    expect(result.ok).toBe(true);
    expect((db.rows("content_posts")[0].media as unknown[]).length).toBe(3);
  });
});

describe("subir un archivo a la biblioteca (F92)", () => {
  const base = {
    postId: POST,
    path: `${WS}/${POST}/nuevo-uuid.jpg`,
    mime: "image/jpeg",
    kind: "image" as const,
    sizeBytes: 5000,
  };

  it("le da su id, guarda el nombre y las dimensiones", async () => {
    const result = await attachMedia({ ...base, name: "portada.jpg", width: 1080, height: 1920 });

    expect(result).toEqual({ ok: true, data: { id: "nuevo-uuid" } });
    const nuevo = (db.rows("content_posts")[0].media as Array<Record<string, unknown>>).at(-1)!;
    expect(nuevo).toMatchObject({ id: "nuevo-uuid", name: "portada.jpg", width: 1080, height: 1920 });
  });

  it("los archivos de antes quedan con su id al escribir", async () => {
    seed({ media: [entry("vieja", "image", false)] });

    await attachMedia(base);

    const ids = (db.rows("content_posts")[0].media as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(["vieja", "nuevo-uuid"]);
  });

  it("rechaza una ruta de otro workspace", async () => {
    const result = await attachMedia({ ...base, path: "otro-ws/post/x.jpg" });

    expect(result.ok).toBe(false);
  });

  it("rechaza un tipo que no cuadra con el mime", async () => {
    expect((await attachMedia({ ...base, kind: "video" })).ok).toBe(false);
    expect((await attachMedia({ ...base, mime: "audio/mpeg" })).ok).toBe(false);
  });

  it("no agrega nada a una pieza que no existe", async () => {
    const result = await attachMedia({ ...base, postId: "no-existe" });

    expect(result.ok).toBe(false);
  });
});
