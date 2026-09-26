/**
 * Lector de metricas de YouTube (F44). Las dos APIs simuladas.
 */

import { describe, it, expect, vi } from "vitest";
import { isShort, parseIsoDuration, readYouTubeMetrics, rowToMetrics, youtubeMediaType } from "./youtube";

function routed(routes: Array<[RegExp, unknown]>) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    const hit = routes.find(([pattern]) => pattern.test(href));
    return { ok: true, status: 200, json: async () => hit?.[1] ?? { items: [] } };
  }) as unknown as typeof fetch;
}

describe("si es un Short (F44)", () => {
  it("lo que dice YouTube manda", () => {
    expect(isShort({ creatorContentType: "SHORTS" })).toBe(true);
    expect(isShort({ creatorContentType: "VIDEO_ON_DEMAND", height: 1920, width: 1080 })).toBe(false);
  });

  it("sin que lo diga, vertical y hasta 3 minutos es Short", () => {
    // Los Shorts y los videos largos no se comparan entre si.
    expect(isShort({ durationSeconds: 45, width: 1080, height: 1920 })).toBe(true);
    expect(isShort({ durationSeconds: 180, width: 1080, height: 1920 })).toBe(true);
  });

  it("vertical pero largo, o corto pero horizontal, no", () => {
    expect(isShort({ durationSeconds: 400, width: 1080, height: 1920 })).toBe(false);
    expect(isShort({ durationSeconds: 45, width: 1920, height: 1080 })).toBe(false);
  });

  it("sin datos no se adivina: queda como video", () => {
    expect(youtubeMediaType({})).toBe("video");
  });
});

describe("la duracion ISO (F44)", () => {
  it("se entiende en sus formatos", () => {
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
  });

  it("una que no se entiende da null, no cero", () => {
    expect(parseIsoDuration("mañana")).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });
});

describe("una fila del reporte (F44)", () => {
  const headers = ["video", "views", "estimatedMinutesWatched", "averageViewDuration", "likes", "comments", "shares", "subscribersGained"];

  it("se lee por nombre de columna, no por posicion", () => {
    // El orden de las columnas no esta garantizado.
    const metrics = rowToMetrics(headers, ["v1", 1000, 50, 30, 80, 12, 8, 5]);

    expect(metrics).toMatchObject({
      views: 1000,
      watchTimeSeconds: 3000,
      avgViewDurationSeconds: 30,
      likes: 80,
      engagementRate: 10,
    });
    expect(metrics.extra).toEqual({ subscribers_gained: 5 });
  });

  it("una columna que no vino queda en null", () => {
    const metrics = rowToMetrics(["video", "views"], ["v1", 100]);

    expect(metrics.likes).toBeNull();
    expect(metrics.watchTimeSeconds).toBeNull();
  });

  it("sin vistas no hay tasa de engagement", () => {
    expect(rowToMetrics(["video", "views", "likes"], ["v1", 0, 5]).engagementRate).toBeNull();
  });
});

describe("leer el canal entero (F44)", () => {
  const impl = () =>
    routed([
      [
        /\/channels\?/,
        {
          items: [
            {
              statistics: { subscriberCount: "1500" },
              contentDetails: { relatedPlaylists: { uploads: "UU123" } },
            },
          ],
        },
      ],
      [/playlistItems/, { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] }],
      [
        /\/videos\?/,
        {
          items: [
            {
              id: "v1",
              snippet: { title: "Un video", publishedAt: "2026-09-20T10:00:00Z", thumbnails: { high: { url: "https://t/1" } } },
              contentDetails: { duration: "PT10M" },
            },
            {
              id: "v2",
              snippet: { title: "Un short", publishedAt: "2026-09-22T10:00:00Z" },
              contentDetails: { duration: "PT30S" },
              fileDetails: { videoStreams: [{ widthPixels: 1080, heightPixels: 1920 }] },
            },
          ],
        },
      ],
      [
        /youtubeanalytics/,
        {
          columnHeaders: [{ name: "video" }, { name: "views" }, { name: "likes" }],
          rows: [
            ["v1", 500, 40],
            ["v2", 9000, 800],
          ],
        },
      ],
    ]);

  const params = { token: "t", channelId: "UC1", startDate: "2026-09-01", endDate: "2026-10-01" };

  it("trae los videos con sus metricas y sus suscriptores", async () => {
    const result = await readYouTubeMetrics({ ...params, fetchImpl: impl() });

    expect(result.posts.map((p) => p.externalPostId)).toEqual(["v1", "v2"]);
    expect(result.posts[1].metrics.views).toBe(9000);
    expect(result.accountDaily[0].followers).toBe(1500);
  });

  it("un video vertical y corto queda marcado como short", async () => {
    const result = await readYouTubeMetrics({ ...params, fetchImpl: impl() });

    expect(result.posts.find((p) => p.externalPostId === "v2")?.mediaType).toBe("short");
    expect(result.posts.find((p) => p.externalPostId === "v1")?.mediaType).toBe("video");
  });

  it("pide las metricas de todos los videos en UNA llamada", async () => {
    // Una llamada por video multiplicaria la cuota por el tamaño del canal.
    const fetchImpl = impl();
    await readYouTubeMetrics({ ...params, fetchImpl });

    const analytics = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes("youtubeanalytics"),
    );
    expect(analytics).toHaveLength(1);
    expect(String(analytics[0][0])).toContain("video==v1,v2");
  });

  it("si fallan las metricas, los videos se devuelven igual", async () => {
    // La fila de la publicacion sirve aunque los numeros no esten.
    const fetchImpl = routed([
      [/\/channels\?/, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] }],
      [/playlistItems/, { items: [{ contentDetails: { videoId: "v1" } }] }],
      [/\/videos\?/, { items: [{ id: "v1", snippet: { title: "Un video" } }] }],
      [/youtubeanalytics/, { error: { message: "quotaExceeded" } }],
    ]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].metrics.views).toBeNull();
    expect(result.warnings[0]).toContain("quotaExceeded");
  });

  it("si falla el canal, lo avisa sin romper", async () => {
    const fetchImpl = routed([[/\/channels\?/, { error: { message: "sin permiso" } }]]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts).toEqual([]);
    expect(result.warnings[0]).toContain("sin permiso");
  });
});
