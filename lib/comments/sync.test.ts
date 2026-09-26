/**
 * Volver a leer los comentarios (F46). Los tres proveedores simulados.
 */

import { describe, it, expect, vi } from "vitest";
import {
  canReadComments,
  LINKEDIN_COMMENTS_NOTE,
  readThreadsReplies,
  readYouTubeComments,
  readZernioComments,
} from "./sync";

function respond(body: unknown) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

describe("de que redes se pueden leer (F46)", () => {
  it("de LinkedIn no, y se dice en pantalla", () => {
    // No es un error nuestro ni se arregla reconectando.
    expect(canReadComments("linkedin")).toBe(false);
    expect(LINKEDIN_COMMENTS_NOTE).toContain("desde LinkedIn");
  });

  it("de las otras cuatro si", () => {
    for (const p of ["instagram", "tiktok", "threads", "youtube"]) {
      expect(canReadComments(p)).toBe(true);
    }
  });
});

describe("Zernio: Instagram y TikTok (F46)", () => {
  const client = (result: { data?: unknown; error?: unknown }) =>
    ({ comments: { getInboxPostComments: vi.fn(async () => result) } }) as never;

  it("trae cada comentario con su autor", async () => {
    const result = await readZernioComments({
      client: client({
        data: {
          comments: [
            {
              id: "c-1",
              message: "SISTEMA",
              createdTime: "2026-10-01T15:00:00Z",
              likeCount: 3,
              from: { id: "u-1", username: "unlead", name: "Un lead" },
            },
          ],
        },
      }),
      postId: "ig-9",
      accountId: "acc-1",
      platform: "instagram",
    });

    expect(result.comments[0]).toMatchObject({
      externalCommentId: "c-1",
      externalPostId: "ig-9",
      authorUsername: "unlead",
      likeCount: 3,
      isOwn: false,
      source: "sync",
    });
  });

  it("isOwner manda: es mas confiable que comparar nombres", async () => {
    const result = await readZernioComments({
      client: client({ data: { comments: [{ id: "c-2", from: { isOwner: true } }] } }),
      postId: "ig-9",
      accountId: "acc-1",
      platform: "instagram",
    });

    expect(result.comments[0].isOwn).toBe(true);
  });

  it("un error vuelve como aviso, sin comentarios", async () => {
    const result = await readZernioComments({
      client: client({ error: { error: "no autorizado" } }),
      postId: "ig-9",
      accountId: "acc-1",
      platform: "tiktok",
    });

    expect(result.comments).toEqual([]);
    expect(result.warnings[0]).toContain("tiktok");
  });
});

describe("Threads (F46)", () => {
  it("las respuestas propias quedan marcadas", async () => {
    const result = await readThreadsReplies({
      token: "t",
      postId: "th-1",
      fetchImpl: respond({
        data: [
          { id: "r-1", text: "Buenisimo", username: "unlead", timestamp: "2026-10-01T15:00:00Z" },
          { id: "r-2", text: "Gracias!", username: "minegocio", is_reply_owned_by_me: true },
        ],
      }),
    });

    expect(result.comments).toHaveLength(2);
    expect(result.comments[1].isOwn).toBe(true);
  });

  it("un error vuelve como aviso", async () => {
    const result = await readThreadsReplies({
      token: "t",
      postId: "th-1",
      fetchImpl: respond({ error: { message: "token vencido" } }),
    });

    expect(result.comments).toEqual([]);
    expect(result.warnings[0]).toContain("token vencido");
  });
});

describe("YouTube (F46)", () => {
  const body = {
    items: [
      {
        snippet: {
          topLevelComment: {
            id: "yc-1",
            snippet: {
              textOriginal: "Muy bueno",
              authorDisplayName: "Alguien",
              authorChannelId: { value: "UC-otro" },
              likeCount: 4,
              publishedAt: "2026-10-01T15:00:00Z",
            },
          },
        },
      },
      {
        snippet: {
          topLevelComment: {
            id: "yc-2",
            snippet: { textOriginal: "Gracias!", authorChannelId: { value: "UC-mio" } },
          },
        },
      },
    ],
  };

  it("trae el comentario de arriba de cada hilo", async () => {
    const result = await readYouTubeComments({
      token: "t",
      videoId: "v1",
      channelId: "UC-mio",
      fetchImpl: respond(body),
    });

    expect(result.comments.map((c) => c.externalCommentId)).toEqual(["yc-1", "yc-2"]);
    expect(result.comments[0].likeCount).toBe(4);
  });

  it("el comentario del propio canal queda marcado como nuestro", async () => {
    const result = await readYouTubeComments({
      token: "t",
      videoId: "v1",
      channelId: "UC-mio",
      fetchImpl: respond(body),
    });

    expect(result.comments[0].isOwn).toBe(false);
    expect(result.comments[1].isOwn).toBe(true);
  });

  it("sin saber cual es nuestro canal, ninguno se marca como propio", async () => {
    // Marcar de mas escondería comentarios reales del hilo.
    const result = await readYouTubeComments({ token: "t", videoId: "v1", fetchImpl: respond(body) });

    expect(result.comments.every((c) => !c.isOwn)).toBe(true);
  });

  it("un error vuelve como aviso", async () => {
    const result = await readYouTubeComments({
      token: "t",
      videoId: "v1",
      fetchImpl: respond({ error: { message: "quotaExceeded" } }),
    });

    expect(result.warnings[0]).toContain("quotaExceeded");
  });
});
