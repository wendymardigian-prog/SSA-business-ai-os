/**
 * El lector del rendimiento de una pieza (F102 a F104).
 *
 * Las cuentas estan probadas en los modulos puros. Lo que importa aca es lo que
 * el lector promete: una pieza sin nada publicado no tiene seccion, y medir
 * NUNCA rompe abrirla. Las consultas con ruta JSON (`attribution->first_touch`)
 * no las entiende la base falsa: se probaron contra la base real.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadPieceMeasurement, touchesFromRows } from "./piece-load";

const WS = "ws-1";

afterEach(() => vi.restoreAllMocks());

describe("touchesFromRows (F104)", () => {
  it("convierte el primer toque de cada contacto en un toque de lead", () => {
    const touches = touchesFromRows([
      {
        id: "c-1",
        first_touch: {
          occurred_at: "2026-10-01T10:00:00Z",
          origin: "comment",
          medium: "comment",
          social_post_id: "sp-1",
          content_post_id: "pc-1",
        },
      },
      // Un contacto sin primer toque no aporta nada.
      { id: "c-2", first_touch: null },
      // Un toque a medias: lo que falta queda en null, no se inventa.
      { id: "c-3", first_touch: { origin: "dm" } },
    ]);

    expect(touches).toEqual([
      {
        contactId: "c-1",
        occurredAt: "2026-10-01T10:00:00Z",
        origin: "comment",
        medium: "comment",
        socialPostId: "sp-1",
        contentPostId: "pc-1",
      },
      { contactId: "c-3", occurredAt: "", origin: "dm", medium: null, socialPostId: null, contentPostId: null },
    ]);
  });
});

describe("loadPieceMeasurement (F102)", () => {
  it("una pieza sin publicaciones que hayan salido no tiene medicion", async () => {
    const db = memoryDb({
      social_posts: [
        // Programada, todavia sin salir.
        { id: "sp-1", workspace_id: WS, content_post_id: "pc-1", platform: "instagram", status: "scheduled", published_at: null, deleted_at: null },
        // Salio, pero es de otra pieza.
        { id: "sp-2", workspace_id: WS, content_post_id: "otra", platform: "instagram", status: "published", published_at: "2026-10-01T10:00:00Z", deleted_at: null },
      ],
    });

    expect(await loadPieceMeasurement(db.client, { workspaceId: WS, pieceId: "pc-1" })).toBeNull();
  });

  it("no mezcla publicaciones de otro negocio ni borradas", async () => {
    const db = memoryDb({
      social_posts: [
        { id: "sp-ajena", workspace_id: "otro-ws", content_post_id: "pc-1", platform: "instagram", published_at: "2026-10-01T10:00:00Z", deleted_at: null },
        { id: "sp-borrada", workspace_id: WS, content_post_id: "pc-1", platform: "instagram", published_at: "2026-10-01T10:00:00Z", deleted_at: "2026-10-02T00:00:00Z" },
      ],
    });

    expect(await loadPieceMeasurement(db.client, { workspaceId: WS, pieceId: "pc-1" })).toBeNull();
  });

  it("si algo inesperado falla, devuelve null y lo registra: abrir la pieza no se rompe", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      from: () => {
        throw new Error("se cayo la conexion");
      },
    } as unknown as Parameters<typeof loadPieceMeasurement>[0];

    expect(await loadPieceMeasurement(broken, { workspaceId: WS, pieceId: "pc-1" })).toBeNull();
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain("[medicion]");
  });

  it("con una publicacion salida arma la fila de su red", async () => {
    const db = memoryDb({
      social_posts: [
        { id: "sp-1", workspace_id: WS, content_post_id: "pc-1", platform: "instagram", media_type: "reel", published_at: "2026-09-26T10:00:00Z", engagement_d7: 7.2, deleted_at: null },
      ],
      social_post_metrics_daily: [
        { workspace_id: WS, social_post_id: "sp-1", date: "2026-09-26", reach: 100, likes: 10, views: null, comments: null, shares: null, saves: null },
        { workspace_id: WS, social_post_id: "sp-1", date: "2026-09-27", reach: 250, likes: 30, views: null, comments: null, shares: null, saves: null },
      ],
      contacts: [],
    });
    // La base falsa no entiende las rutas JSON de los contactos: lo tolera como un error de lectura.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await loadPieceMeasurement(db.client, {
      workspaceId: WS,
      pieceId: "pc-1",
      now: new Date("2026-10-06T12:00:00Z"),
    });

    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({ platform: "instagram", ageDays: 10, reach: 250, interactions: 30, engagementD7: 7.2 });
    // Sin vecinas en la base, no hay indice: base insuficiente, no un numero inventado.
    expect(result?.rows[0].index.status).toBe("insufficient");
  });
});
