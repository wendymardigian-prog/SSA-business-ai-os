/**
 * F93: `savePostDraft` ya no escribe las redes tal cual llegan.
 *
 * Antes `networks` era un jsonb sin forma: cualquier cosa que mandara el
 * navegador quedaba guardada. Ahora se valida, y los archivos se limpian
 * contra la biblioteca real de la pieza.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";

let db: MemoryDb;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "user-1" },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role: "admin",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const { savePostDraft } = await import("./content");

const img = (id: string) => ({
  id,
  storage_path: `${WS}/${POST}/${id}.jpg`,
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 1000,
});

beforeEach(() => {
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        status: "draft",
        updated_at: "2026-10-01T00:00:00Z",
        media: [img("a"), img("b"), img("c")],
        networks: [{ platform: "instagram", planned_at: null }],
      },
    ],
    social_posts: [],
    workspace_roles: [],
  });
});

describe("savePostDraft valida las redes (hallazgo 1)", () => {
  it("guarda unas redes bien formadas", async () => {
    const networks = [{ platform: "instagram", format: "carousel", files: ["a", "b"], caption: "Hola" }];

    const result = await savePostDraft({ postId: POST, networks });

    expect(result.ok).toBe(true);
    expect(db.rows("content_posts")[0].networks).toEqual(networks);
  });

  it("rechaza algo que no tiene forma de redes y NO escribe nada", async () => {
    const result = await savePostDraft({ postId: POST, title: "No deberia quedar", networks: "basura" as never });

    expect(result.ok).toBe(false);
    expect(db.rows("content_posts")[0].title).toBe("Una pieza");
    expect(db.rows("content_posts")[0].networks).toEqual([{ platform: "instagram", planned_at: null }]);
  });

  it("rechaza una red desconocida y dos entradas de la misma red", async () => {
    expect((await savePostDraft({ postId: POST, networks: [{ platform: "facebook" }] })).ok).toBe(false);
    expect(
      (await savePostDraft({ postId: POST, networks: [{ platform: "instagram" }, { platform: "instagram" }] })).ok,
    ).toBe(false);
  });

  it("rechaza un formato que esa red no tiene", async () => {
    const result = await savePostDraft({ postId: POST, networks: [{ platform: "instagram", format: "pdf" }] });

    expect(result.ok).toBe(false);
  });

  it("descarta los ids de archivo que no estan en la biblioteca", async () => {
    await savePostDraft({
      postId: POST,
      networks: [{ platform: "instagram", format: "carousel", files: ["a", "borrado-en-otra-pestana", "c"] }],
    });

    const [red] = db.rows("content_posts")[0].networks as Array<{ files: string[] }>;
    expect(red.files).toEqual(["a", "c"]);
  });

  it("con formato y sin lista de archivos, quedan en una lista vacia (no 'toda la base')", async () => {
    await savePostDraft({ postId: POST, networks: [{ platform: "instagram", format: "reel" }] });

    const [red] = db.rows("content_posts")[0].networks as Array<{ files: string[] }>;
    expect(red.files).toEqual([]);
  });

  it("un guardado que no toca las redes no las valida ni las reescribe", async () => {
    await savePostDraft({ postId: POST, title: "Otro titulo" });

    expect(db.rows("content_posts")[0].networks).toEqual([{ platform: "instagram", planned_at: null }]);
  });

  it("el aviso de 'alguien mas edito esto' compara con la ultima escritura, no con la de la primera carga", async () => {
    // El primer guardado devuelve su fecha; si el segundo manda esa, no hay aviso.
    const first = await savePostDraft({ postId: POST, title: "Uno", knownUpdatedAt: "2026-10-01T00:00:00Z" });
    expect(first.ok && first.data.staleWarning).toBe(false);

    // Otro guardado con una fecha vieja SI avisa.
    const second = await savePostDraft({ postId: POST, title: "Dos", knownUpdatedAt: "1999-01-01T00:00:00Z" });
    expect(second.ok && second.data.staleWarning).toBe(true);
  });
});
