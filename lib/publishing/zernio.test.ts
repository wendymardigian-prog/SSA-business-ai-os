/**
 * Lo que recibe Zernio, de punta a punta (caracterizacion de C9, Contenido v4).
 *
 * Este test fija el cuerpo EXACTO que le llega a Zernio para cada formato de
 * Instagram y TikTok, armado con las piezas reales (`buildInput` +
 * `zernioScheduler` / `zernioPublisher`). Solo se simula el cliente del SDK.
 *
 * Es lo que decide si Instagram publica un Reel o un post de feed: el error
 * mas caro de toda la publicacion. Por eso **las salidas esperadas
 * (`expected`) no se cambian nunca**: si unificar el formato (C9) cambia algo
 * de lo que sale, el test tiene que ponerse rojo.
 *
 * Se escribio el 7/10/2026, ANTES de C9, con las dos formas que existian
 * entonces para pedir un tipo de Instagram: la vieja (`options.contentType`)
 * y la nueva (`format`), probando que las dos daban la MISMA salida — esa
 * prueba de equivalencia es lo que permitio migrar los datos con confianza
 * (00126) y borrar despues la forma vieja. Ya borrada la vieja (C9 completo,
 * 7/10/2026), los casos que pedian el tipo SOLO por `contentType` se
 * sacaron: ya no es una entrada valida (el schema no la acepta mas). Los
 * casos por `format` quedan, con la MISMA salida que entonces.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { createZernioClient } = vi.hoisted(() => ({ createZernioClient: vi.fn() }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient }));

const { buildInput } = await import("./dispatcher");
const { zernioScheduler, zernioPublisher } = await import("./zernio");

const WS = "ws-1";
const POST = "post-1";
const AT = "2026-10-15T16:00:00.000Z";
const TZ = "America/Costa_Rica";

type Kind = "image" | "video";
const file = (id: string, kind: Kind) => ({
  id,
  storage_path: `${WS}/${POST}/${id}.${kind === "video" ? "mp4" : "jpg"}`,
  mime_type: kind === "video" ? "video/mp4" : "image/jpeg",
  kind,
  size_bytes: 1_000_000,
});
const url = (id: string, kind: Kind) =>
  `https://firmada.test/${WS}/${POST}/${id}.${kind === "video" ? "mp4" : "jpg"}`;

const deps = {
  signMedia: async (paths: string[]) => paths.map((p) => `https://firmada.test/${p}`),
  credentialsFor: async () => ({}) as never,
};

async function bodyFor(
  platform: "instagram" | "tiktok",
  media: ReturnType<typeof file>[],
  network: Record<string, unknown>,
  mode: "schedule" | "now" = "schedule",
) {
  const db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        caption: "Caption base",
        media,
        networks: [{ platform, ...network }],
      },
    ],
  });

  const input = await buildInput(
    db.client as never,
    { content_post_id: POST, platform, requested_visibility: null, accountRef: `${platform}-acc` },
    deps,
  );

  const createPost = vi.fn().mockResolvedValue({
    data: { post: { _id: "zp-1", platforms: [{ platform, status: "processing" }] } },
  });
  createZernioClient.mockReturnValue({ posts: { createPost } });

  if (mode === "now") {
    await zernioPublisher.publish({ input, credentials: { token: "k" } } as never);
  } else {
    await zernioScheduler.create({
      input,
      credentials: { token: "k" },
      at: AT,
      timezone: TZ,
      requestId: "sp-1:1",
    } as never);
  }

  return createPost.mock.calls[0][0] as { body: Record<string, unknown>; headers?: unknown };
}

const scheduled = { scheduledFor: AT, timezone: TZ };

type Case = {
  name: string;
  platform: "instagram" | "tiktok";
  media: ReturnType<typeof file>[];
  /** Las formas de pedir lo mismo. Todas tienen que dar `expected`. */
  inputs: Record<string, Record<string, unknown>>;
  expected: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    name: "Instagram Reel",
    platform: "instagram",
    media: [file("v1", "video")],
    inputs: {
      "formato reel": { format: "reel", files: ["v1"], options: { shareToFeed: true } },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "video", url: url("v1", "video") }],
      platforms: [
        { platform: "instagram", accountId: "instagram-acc", platformSpecificData: { shareToFeed: true } },
      ],
      ...scheduled,
    },
  },
  {
    name: "Instagram post de feed con una imagen",
    platform: "instagram",
    media: [file("i1", "image")],
    inputs: {
      "formato image": { format: "image", files: ["i1"] },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "image", url: url("i1", "image") }],
      platforms: [{ platform: "instagram", accountId: "instagram-acc", platformSpecificData: {} }],
      ...scheduled,
    },
  },
  {
    name: "Instagram carrusel de tres imagenes, en orden",
    platform: "instagram",
    media: [file("i1", "image"), file("i2", "image"), file("i3", "image")],
    inputs: {
      "formato carousel": { format: "carousel", files: ["i1", "i2", "i3"] },
    },
    expected: {
      content: "Caption base",
      mediaItems: [
        { type: "image", url: url("i1", "image") },
        { type: "image", url: url("i2", "image") },
        { type: "image", url: url("i3", "image") },
      ],
      platforms: [{ platform: "instagram", accountId: "instagram-acc", platformSpecificData: {} }],
      ...scheduled,
    },
  },
  {
    name: "Instagram Story: lo UNICO que manda tipo",
    platform: "instagram",
    media: [file("v1", "video")],
    inputs: {
      "formato story": { format: "story", files: ["v1"] },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "video", url: url("v1", "video") }],
      platforms: [
        { platform: "instagram", accountId: "instagram-acc", platformSpecificData: { contentType: "story" } },
      ],
      ...scheduled,
    },
  },
  {
    name: "Instagram Reel con colaboradores y portada",
    platform: "instagram",
    media: [file("v1", "video")],
    inputs: {
      "formato reel": {
        format: "reel",
        files: ["v1"],
        options: { collaborators: ["sofi.ramirez"], coverOffsetMs: 1500, shareToFeed: false },
      },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "video", url: url("v1", "video") }],
      platforms: [
        {
          platform: "instagram",
          accountId: "instagram-acc",
          platformSpecificData: { shareToFeed: false, collaborators: ["sofi.ramirez"], thumbOffset: 1500 },
        },
      ],
      ...scheduled,
    },
  },
  {
    name: "TikTok video publico con todas sus opciones",
    platform: "tiktok",
    media: [file("v1", "video")],
    inputs: {
      "formato video": {
        format: "video",
        files: ["v1"],
        options: {
          privacyLevel: "PUBLIC_TO_EVERYONE",
          allowComment: true,
          allowDuet: false,
          allowStitch: true,
          commercialContentType: "none",
          coverOffsetMs: 2000,
          contentPreviewConfirmed: true,
          expressConsentGiven: true,
        },
      },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "video", url: url("v1", "video") }],
      platforms: [
        {
          platform: "tiktok",
          accountId: "tiktok-acc",
          platformSpecificData: {
            mediaType: "video",
            privacyLevel: "PUBLIC_TO_EVERYONE",
            allowComment: true,
            allowDuet: false,
            allowStitch: true,
            commercialContentType: "none",
            videoCoverTimestampMs: 2000,
            contentPreviewConfirmed: true,
            expressConsentGiven: true,
          },
        },
      ],
      ...scheduled,
    },
  },
  {
    name: "TikTok carrusel de fotos",
    platform: "tiktok",
    media: [file("i1", "image"), file("i2", "image")],
    inputs: {
      "formato photos": {
        format: "photos",
        files: ["i2", "i1"],
        options: { privacyLevel: "SELF_ONLY", contentPreviewConfirmed: true, expressConsentGiven: true },
      },
    },
    expected: {
      content: "Caption base",
      mediaItems: [
        { type: "image", url: url("i2", "image") },
        { type: "image", url: url("i1", "image") },
      ],
      platforms: [
        {
          platform: "tiktok",
          accountId: "tiktok-acc",
          platformSpecificData: {
            mediaType: "photo",
            privacyLevel: "SELF_ONLY",
            contentPreviewConfirmed: true,
            expressConsentGiven: true,
          },
        },
      ],
      ...scheduled,
    },
  },
  {
    name: "TikTok como borrador: no pide confirmaciones",
    platform: "tiktok",
    media: [file("v1", "video")],
    inputs: {
      "formato video": { format: "video", files: ["v1"], options: { mode: "draft" } },
    },
    expected: {
      content: "Caption base",
      mediaItems: [{ type: "video", url: url("v1", "video") }],
      platforms: [
        {
          platform: "tiktok",
          accountId: "tiktok-acc",
          platformSpecificData: { draft: true, mediaType: "video" },
        },
      ],
      ...scheduled,
    },
  },
];

beforeEach(() => createZernioClient.mockReset());

describe("C9 · lo que recibe Zernio al programar, por formato", () => {
  for (const c of CASES) {
    for (const [inputName, network] of Object.entries(c.inputs)) {
      it(`${c.name} · ${inputName}`, async () => {
        const call = await bodyFor(c.platform, c.media, network);
        expect(call.body).toEqual(c.expected);
        expect(call.headers).toEqual({ "x-request-id": "sp-1:1" });
      });
    }
  }
});

describe("C9 · publicar ahora manda el mismo cuerpo, con publishNow", () => {
  const reel = CASES[0];
  for (const [inputName, network] of Object.entries(reel.inputs)) {
    it(`${reel.name} · ${inputName}`, async () => {
      const call = await bodyFor(reel.platform, reel.media, network, "now");
      const { scheduledFor: _s, timezone: _t, ...rest } = reel.expected;
      expect(call.body).toEqual({ ...rest, publishNow: true });
    });
  }
});
