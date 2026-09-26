/**
 * Los avisos del proveedor cuando una publicacion termina (F35).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { resetPublishers } from "./registry";
import { fromPostproxyEvent, fromZernioPlatformEvent, settlePublication } from "./inbound";

beforeEach(() => resetPublishers());

describe("aviso de Zernio (F35)", () => {
  const base = {
    post: { id: "z1" },
    account: { accountId: "a", platform: "instagram", username: "x" },
  };

  it("una red que salio trae el id y el link", () => {
    const event = fromZernioPlatformEvent({
      ...base,
      event: "post.platform.published",
      platform: {
        name: "instagram",
        status: "published",
        platformPostId: "ig-9",
        publishedUrl: "https://ig/9",
      },
    });

    expect(event).toMatchObject({
      ref: "z1",
      platform: "instagram",
      result: { status: "published", externalId: "ig-9", externalUrl: "https://ig/9" },
    });
  });

  it("una que fallo es un fallo permanente con el motivo de la red", () => {
    // La red ya la rechazo: reintentar lo mismo da lo mismo.
    const event = fromZernioPlatformEvent({
      ...base,
      event: "post.platform.failed",
      platform: { name: "tiktok", status: "failed", error: "Video demasiado corto" },
    });

    expect(event?.result).toMatchObject({
      status: "failed",
      error: "Video demasiado corto",
      errorKind: "permanent",
    });
  });

  it("un borrado en la red no cambia el resultado de haber publicado", () => {
    expect(
      fromZernioPlatformEvent({
        ...base,
        event: "post.platform.deleted",
        platform: { name: "instagram", status: "deleted" },
      }),
    ).toBeNull();
  });

  it("un payload sin post ni red se ignora en vez de romper", () => {
    expect(fromZernioPlatformEvent({ event: "post.platform.published" })).toBeNull();
  });
});

describe("aviso de Postproxy (F35)", () => {
  it("publicado deja el link", () => {
    const event = fromPostproxyEvent({
      post_id: "pp-1",
      status: "published",
      platform: "youtube",
      url: "https://youtu.be/9",
    });

    expect(event).toMatchObject({
      ref: "pp-1",
      platform: "youtube",
      result: { status: "published", externalUrl: "https://youtu.be/9" },
    });
  });

  it("sin plataforma se asume YouTube, que es para lo unico que se usa", () => {
    expect(fromPostproxyEvent({ post_id: "pp-1", status: "published" })?.platform).toBe("youtube");
  });

  it("un estado intermedio no cambia nada", () => {
    expect(fromPostproxyEvent({ post_id: "pp-1", status: "scheduled" })).toBeNull();
  });
});

describe("aplicar el aviso (F35)", () => {
  const db = (status: string) =>
    memoryDb({
      social_posts: [
        {
          id: "sp-1",
          workspace_id: "ws-1",
          content_post_id: "post-1",
          platform: "instagram",
          publisher_ref: "z1",
          status,
          deleted_at: null,
        },
      ],
      content_posts: [{ id: "post-1", status: "scheduled" }],
    });

  const published = {
    ref: "z1",
    platform: "instagram",
    result: { status: "published" as const, externalId: "ig-9", externalUrl: "https://ig/9" },
  };

  it("una que estaba esperando queda publicada", async () => {
    const memory = db("publishing");

    expect(await settlePublication(memory.client, published)).toBe(true);
    expect(memory.rows("social_posts")[0]).toMatchObject({
      status: "published",
      external_post_id: "ig-9",
    });
    expect(memory.rows("content_posts")[0].status).toBe("published");
  });

  it("si la revision ya la resolvio, el aviso llega tarde y no pisa nada", async () => {
    const memory = db("failed");

    expect(await settlePublication(memory.client, published)).toBe(false);
    expect(memory.rows("social_posts")[0].status).toBe("failed");
  });

  it("un aviso de una publicacion que no es nuestra no escribe nada", async () => {
    const memory = db("publishing");

    expect(await settlePublication(memory.client, { ...published, ref: "otro" })).toBe(false);
    expect(memory.rows("social_posts")[0].status).toBe("publishing");
  });
});
