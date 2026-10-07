/**
 * Lo que se le manda al publicador sale de la pieza con el formato aplicado
 * (F92/F93): los archivos en el orden elegido, y las opciones que dice el
 * formato. Es el ultimo eslabon entre lo que muestra el editor y lo que sale.
 */

import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { buildInput, type PublishDeps } from "./dispatcher";
import { tiktokData } from "./zernio";

const WS = "ws-1";
const POST = "post-1";

const file = (id: string, kind: "image" | "video") => ({
  id,
  storage_path: `${WS}/${POST}/${id}.${kind === "video" ? "mp4" : "jpg"}`,
  mime_type: kind === "video" ? "video/mp4" : "image/jpeg",
  kind,
  size_bytes: 1_000_000,
});

const deps: PublishDeps = {
  signMedia: async (paths) => paths.map((p) => `https://firmada.test/${p}`),
  credentialsFor: async () => ({}) as never,
};

function seed(networks: unknown[]) {
  return memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        caption: "Caption base",
        media: [file("v1", "video"), file("i1", "image"), file("i2", "image"), file("i3", "image")],
        networks,
      },
    ],
  });
}

const row = (platform: string) => ({
  content_post_id: POST,
  platform,
  requested_visibility: null,
  accountRef: null,
});

describe("buildInput con formato y archivos (F92/F93)", () => {
  it("manda los archivos EN EL ORDEN elegido, con sus URLs firmadas", async () => {
    const db = seed([{ platform: "instagram", format: "carousel", files: ["i3", "i1", "i2"] }]);

    const input = await buildInput(db.client as never, row("instagram"), deps);

    expect(input.media.map((m) => m.storage_path.split("/").pop())).toEqual(["i3.jpg", "i1.jpg", "i2.jpg"]);
    expect(input.mediaUrls.map((u) => u.split("/").pop())).toEqual(["i3.jpg", "i1.jpg", "i2.jpg"]);
  });

  it("no manda lo que la red no eligio", async () => {
    const db = seed([{ platform: "instagram", format: "reel", files: ["v1"] }]);

    const input = await buildInput(db.client as never, row("instagram"), deps);

    expect(input.media).toHaveLength(1);
    expect(input.media[0].kind).toBe("video");
  });

  it("el formato viaja aparte en `input.format`, y las opciones propias de Instagram quedan", async () => {
    const db = seed([
      { platform: "instagram", format: "reel", files: ["v1"], options: { shareToFeed: true } },
    ]);

    const input = await buildInput(db.client as never, row("instagram"), deps);

    expect(input.format).toBe("reel");
    expect(input.options).toMatchObject({ shareToFeed: true });
  });

  it("TikTok con fotos manda mediaType photo, y tiktokData lo lleva al proveedor", async () => {
    const db = seed([
      {
        platform: "tiktok",
        format: "photos",
        files: ["i1", "i2"],
        options: { privacyLevel: "PUBLIC_TO_EVERYONE", contentPreviewConfirmed: true, expressConsentGiven: true },
      },
    ]);

    const input = await buildInput(db.client as never, row("tiktok"), deps);

    expect(input.options).toMatchObject({ mediaType: "photo" });
    expect(tiktokData(input.options)).toMatchObject({ mediaType: "photo" });
  });

  it("TikTok con video manda mediaType video", async () => {
    const db = seed([{ platform: "tiktok", format: "video", files: ["v1"] }]);

    const input = await buildInput(db.client as never, row("tiktok"), deps);

    expect(tiktokData(input.options)).toMatchObject({ mediaType: "video" });
  });

  it("sin formato, tiktokData no inventa un mediaType", () => {
    expect(tiktokData({ privacyLevel: "PUBLIC_TO_EVERYONE" })).not.toHaveProperty("mediaType");
  });

  it("una red del modelo anterior (sin files) sigue mandando TODA la base", async () => {
    const db = seed([{ platform: "instagram" }]);

    const input = await buildInput(db.client as never, row("instagram"), deps);

    expect(input.media).toHaveLength(4);
  });

  it("un archivo que se borro de la biblioteca no se manda", async () => {
    const db = seed([{ platform: "instagram", format: "carousel", files: ["i1", "fantasma", "i2"] }]);

    const input = await buildInput(db.client as never, row("instagram"), deps);

    expect(input.media.map((m) => m.storage_path.split("/").pop())).toEqual(["i1.jpg", "i2.jpg"]);
  });
});
