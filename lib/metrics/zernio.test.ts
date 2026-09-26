/**
 * Lector de metricas de Zernio (F42). Con el SDK simulado.
 */

import { describe, it, expect, vi } from "vitest";
import { mediaTypeOf, normalizePostMetrics, readZernioMetrics, toSnapshot } from "./zernio";

function clientReturning(...pages: Array<{ data?: unknown; error?: unknown }>) {
  const queue = [...pages];
  const getAnalytics = vi.fn(
    async (_options: { query: Record<string, unknown> }) => queue.shift() ?? { data: { posts: [] } },
  );
  return {
    client: { analytics: { getAnalytics } } as never,
    getAnalytics,
  };
}

const params = (over = {}) => ({
  apiKey: "k",
  accountId: "acc-1",
  platform: "instagram",
  fromDate: "2026-09-01",
  ...over,
});

describe("normalizar las metricas (F42)", () => {
  it("lo que no vino queda en null, no en cero", () => {
    // Un cero inventado se lee en el grafico como "ese dia no paso nada".
    const metrics = normalizePostMetrics({ likes: 10 });

    expect(metrics.likes).toBe(10);
    expect(metrics.reach).toBeNull();
    expect(metrics.saves).toBeNull();
  });

  it("un cero de verdad se conserva", () => {
    expect(normalizePostMetrics({ likes: 0 }).likes).toBe(0);
  });

  it("los tiempos de Reels pasan de milisegundos a segundos", () => {
    const metrics = normalizePostMetrics({
      igReelsAvgWatchTime: 4500,
      igReelsVideoViewTotalTime: 120000,
    });

    expect(metrics.avgViewDurationSeconds).toBe(5);
    expect(metrics.watchTimeSeconds).toBe(120);
  });

  it("las metricas sin columna propia van a extra", () => {
    const metrics = normalizePostMetrics({ follows: 7, clicks: 3 });

    expect(metrics.extra).toEqual({ follows: 7, clicks: 3 });
  });

  it("sin analitica devuelve todo en null", () => {
    expect(normalizePostMetrics(null).views).toBeNull();
    expect(normalizePostMetrics(undefined).extra).toEqual({});
  });
});

describe("el tipo de media (F42)", () => {
  it("se traduce al vocabulario nuestro", () => {
    expect(mediaTypeOf("carousel")).toBe("carousel");
    expect(mediaTypeOf("gif")).toBe("image");
    expect(mediaTypeOf("text")).toBe("text");
  });

  it("uno que no conocemos queda sin tipo, no inventado", () => {
    expect(mediaTypeOf("holograma")).toBeNull();
    expect(mediaTypeOf(undefined)).toBeNull();
  });
});

describe("un post de Zernio a lo nuestro (F42)", () => {
  const post = {
    _id: "z1",
    content: "El caption",
    publishedAt: "2026-09-20T15:00:00Z",
    mediaType: "video",
    thumbnailUrl: "https://cdn/t.jpg",
    platforms: [
      {
        platform: "instagram",
        platformPostId: "ig-9",
        platformPostUrl: "https://ig/9",
        analytics: { likes: 20, reach: 300 },
      },
    ],
  };

  it("el id que se guarda es el DE LA RED, no el de Zernio", () => {
    // Es la unica clave que cruza lo que publicamos con lo que se lee.
    const snapshot = toSnapshot(post, "instagram");

    expect(snapshot).toMatchObject({
      externalPostId: "ig-9",
      publisherRef: "z1",
      url: "https://ig/9",
      caption: "El caption",
      mediaType: "video",
    });
    expect(snapshot?.metrics.likes).toBe(20);
  });

  it("un post sin id en la red se saltea: no hay con que cruzarlo", () => {
    expect(toSnapshot({ _id: "z2", platforms: [{ platform: "instagram" }] }, "instagram")).toBeNull();
  });

  it("de un post en varias redes se toma la que corresponde", () => {
    const multi = {
      _id: "z3",
      platforms: [
        { platform: "instagram", platformPostId: "ig-1", analytics: { likes: 1 } },
        { platform: "tiktok", platformPostId: "tt-1", analytics: { likes: 99 } },
      ],
    };

    expect(toSnapshot(multi, "tiktok")?.metrics.likes).toBe(99);
  });
});

describe("leer una cuenta entera (F42)", () => {
  it("sigue las paginas hasta la ultima", async () => {
    const { client, getAnalytics } = clientReturning(
      {
        data: {
          posts: [{ _id: "z1", platforms: [{ platform: "instagram", platformPostId: "ig-1" }] }],
          pagination: { page: 1, totalPages: 2 },
        },
      },
      {
        data: {
          posts: [{ _id: "z2", platforms: [{ platform: "instagram", platformPostId: "ig-2" }] }],
          pagination: { page: 2, totalPages: 2 },
        },
      },
    );

    const result = await readZernioMetrics(params({ client }));

    expect(result.posts.map((p) => p.externalPostId)).toEqual(["ig-1", "ig-2"]);
    expect(getAnalytics).toHaveBeenCalledTimes(2);
  });

  it("pide tambien lo publicado a mano", async () => {
    // Un dashboard que solo cuenta lo nuestro no sirve para decidir nada.
    const { client, getAnalytics } = clientReturning({ data: { posts: [] } });

    await readZernioMetrics(params({ client }));

    expect(getAnalytics.mock.calls[0][0].query.source).toBe("all");
  });

  it("trae los seguidores de la cuenta", async () => {
    const { client } = clientReturning({
      data: { posts: [], accounts: [{ _id: "acc-1", followerCount: 4200 }] },
    });

    const result = await readZernioMetrics(params({ client }));

    expect(result.accountDaily[0].followers).toBe(4200);
  });

  it("sin plan de analitica lo dice y no sigue pidiendo", async () => {
    const { client, getAnalytics } = clientReturning({
      data: { posts: [], hasAnalyticsAccess: false, pagination: { page: 1, totalPages: 5 } },
    });

    const result = await readZernioMetrics(params({ client }));

    expect(result.warnings[0]).toContain("plan de Zernio");
    expect(getAnalytics).toHaveBeenCalledTimes(1);
  });

  it("un error corta pero devuelve lo que ya se leyo", async () => {
    // Perder los posts de la primera pagina por un fallo en la segunda seria
    // tirar datos buenos.
    const { client } = clientReturning(
      {
        data: {
          posts: [{ _id: "z1", platforms: [{ platform: "instagram", platformPostId: "ig-1" }] }],
          pagination: { page: 1, totalPages: 3 },
        },
      },
      { error: { error: "rate limited" } },
    );

    const result = await readZernioMetrics(params({ client }));

    expect(result.posts).toHaveLength(1);
    expect(result.warnings[0]).toContain("rate limited");
  });
});
