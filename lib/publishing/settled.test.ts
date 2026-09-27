/**
 * El cierre de una red, para los tres caminos (A6, A13).
 *
 * El caso que mas importa: Zernio casi siempre contesta "en proceso", asi
 * que la publicacion se cierra por la revision o por el webhook. Antes solo
 * el camino inmediato completaba el `postIds`, y la automatizacion "solo
 * este post" se quedaba esperando un id que nunca llegaba.
 */

import { describe, it, expect } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { onPublicationSettled } from "./settled";

const WS = "ws-1";
const POST = "post-1";
const PUB = "sp-1";

function seed(status: string, over: Record<string, unknown> = {}): MemoryDb {
  return memoryDb({
    social_posts: [
      {
        id: PUB,
        workspace_id: WS,
        content_post_id: POST,
        platform: "instagram",
        status,
        external_post_id: status === "published" ? "ig-999" : null,
        social_account_id: "acc-1",
        last_error: status === "failed" ? "Instagram rechazo el video" : null,
        deleted_at: null,
        ...over,
      },
    ],
    social_accounts: [{ id: "acc-1", workspace_id: WS, channel_id: "chan-1" }],
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        status: "scheduled",
        networks: [
          { platform: "instagram", cta: { type: "comment", keyword: "SISTEMA" } },
        ],
      },
    ],
    // Una automatizacion por comentario limitada a posts puntuales: es la
    // que hay que completar.
    triggers: [
      {
        id: "trg-1",
        workspace_id: WS,
        flow_id: "flow-1",
        type: "comment_keyword",
        is_active: true,
        channel_id: "chan-1",
        config: { keywords: [{ value: "SISTEMA" }], postIds: ["ig-anterior"] },
      },
    ],
    flows: [{ id: "flow-1", name: "Guia por DM" }],
    notifications: [],
  });
}

describe("A6 · el postId de la automatizacion se completa siempre", () => {
  it("lo completa cuando la red se cierra publicada", async () => {
    const db = seed("published");

    await onPublicationSettled(db.client, PUB);

    const config = db.rows("triggers")[0].config as { postIds: string[] };
    expect(config.postIds).toContain("ig-999");
    // Y no pisa los que ya estaban.
    expect(config.postIds).toContain("ig-anterior");
  });

  it("no toca nada si la red todavia esta en proceso", async () => {
    const db = seed("publishing");

    await onPublicationSettled(db.client, PUB);

    expect((db.rows("triggers")[0].config as { postIds: string[] }).postIds).toEqual(["ig-anterior"]);
  });

  it("volver a cerrarla no duplica el id", async () => {
    const db = seed("published");

    await onPublicationSettled(db.client, PUB);
    await onPublicationSettled(db.client, PUB);

    const config = db.rows("triggers")[0].config as { postIds: string[] };
    expect(config.postIds.filter((id) => id === "ig-999")).toHaveLength(1);
  });
});

describe("A13 · el estado de la pieza y el aviso", () => {
  it("una red publicada deja la pieza publicada", async () => {
    const db = seed("published");

    await onPublicationSettled(db.client, PUB);

    expect(db.rows("content_posts")[0].status).toBe("published");
  });

  it("una red fallida deja la pieza fallida y avisa", async () => {
    const db = seed("failed");

    await onPublicationSettled(db.client, PUB);

    expect(db.rows("content_posts")[0].status).toBe("failed");
    expect(db.rows("notifications")).toHaveLength(1);
    expect(db.rows("notifications")[0].body).toContain("Instagram rechazo el video");
  });

  it("una red en proceso tambien actualiza el estado de la pieza, sin avisar", async () => {
    const db = seed("publishing");

    await onPublicationSettled(db.client, PUB);

    expect(db.rows("content_posts")[0].status).toBe("publishing");
    expect(db.rows("notifications")).toHaveLength(0);
  });
});
