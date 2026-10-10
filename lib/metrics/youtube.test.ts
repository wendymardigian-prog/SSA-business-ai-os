/**
 * Lector de metricas de YouTube (F44). Las dos APIs simuladas.
 */

import { describe, it, expect, vi } from "vitest";
import {
  channelProfile,
  count,
  isShort,
  checkIsShort,
  isVisibleOnChannel,
  mediaTypeFromFlag,
  parseIsoDuration,
  plainError,
  readYouTubeMetrics,
  reportStartDate,
  rowToMetrics,
  statisticsToMetrics,
  streamSize,
  youtubeMediaType,
} from "./youtube";

/**
 * Las APIs simuladas. `youtube.com/shorts/<id>` responde como YouTube: 200 si
 * el id esta en `shorts`, 303 a /watch si no.
 */
function routed(routes: Array<[RegExp, unknown]>, shorts: string[] = []) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.startsWith("https://www.youtube.com/shorts/")) {
      const id = href.split("/").pop() ?? "";
      const isShortVideo = shorts.includes(id);
      return {
        ok: isShortVideo,
        status: isShortVideo ? 200 : 303,
        headers: new Headers(isShortVideo ? {} : { location: `https://www.youtube.com/watch?v=${id}` }),
        json: async () => ({}),
      };
    }
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
              statistics: { viewCount: "999" },
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
    ], ["v2"]);

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

    // La otra llamada a Analytics es la del tipo de cada video (una sola, para todos).
    const analytics = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).includes("youtubeanalytics") && !String(c[0]).includes("creatorContentType"),
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

  it("el encabezado recibe la cantidad de videos y las vistas del canal", async () => {
    const fetchImpl = routed([
      [
        /\/channels\?/,
        {
          items: [
            {
              statistics: { subscriberCount: "413", videoCount: "27", viewCount: "15800" },
              contentDetails: { relatedPlaylists: { uploads: "UU123" } },
            },
          ],
        },
      ],
    ]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.accountDaily[0]).toMatchObject({
      followers: 413,
      extra: { profile: { videos: 27, views: 15800 } },
    });
  });

  it("a Analytics le pide desde el video mas viejo, no desde la ventana", async () => {
    // La fila del dia es acumulada: con la ventana, un video de julio quedaba
    // con las vistas de los ultimos 30 dias como si fueran su total.
    const fetchImpl = routed([
      [/\/channels\?/, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] }],
      [/playlistItems/, { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] }],
      [
        /\/videos\?/,
        {
          items: [
            { id: "v1", snippet: { publishedAt: "2026-07-07T18:00:00Z" } },
            { id: "v2", snippet: { publishedAt: "2025-05-24T10:00:00Z" } },
          ],
        },
      ],
    ]);

    await readYouTubeMetrics({ ...params, fetchImpl });

    const analytics = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("youtubeanalytics"),
    );
    expect(String(analytics?.[0])).toContain("startDate=2025-05-24");
  });

  it("un video sin fila en Analytics toma los totales de la Data API", async () => {
    // Analytics tarda dias en tener un video nuevo.
    const fetchImpl = routed([
      [/\/channels\?/, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] }],
      [/playlistItems/, { items: [{ contentDetails: { videoId: "v1" } }] }],
      [
        /\/videos\?/,
        {
          items: [
            {
              id: "v1",
              snippet: { publishedAt: "2026-07-07T18:00:00Z" },
              statistics: { viewCount: "1200", likeCount: "48", commentCount: "12" },
            },
          ],
        },
      ],
      [/youtubeanalytics/, { columnHeaders: [{ name: "video" }, { name: "views" }], rows: [] }],
    ]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts[0].metrics).toMatchObject({ views: 1200, likes: 48, comments: 12, engagementRate: 5 });
  });

  it("si Analytics tiene la fila, manda Analytics", async () => {
    const result = await readYouTubeMetrics({ ...params, fetchImpl: impl() });

    expect(result.posts[0].metrics.views).toBe(500);
  });

  it("trae el perfil del canal: foto, @ y nombre", async () => {
    const fetchImpl = routed([
      [
        /\/channels\?/,
        {
          items: [
            {
              snippet: {
                title: "Cuenta Demo",
                customUrl: "@cuenta_demo",
                description: "Sistemas para negocios",
                thumbnails: { default: { url: "https://yt3/88" }, high: { url: "https://yt3/800" } },
              },
              statistics: { subscriberCount: "413" },
            },
          ],
        },
      ],
    ]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.profile).toEqual({
      username: "cuenta_demo",
      displayName: "Cuenta Demo",
      avatarUrl: "https://yt3/800",
      bio: "Sistemas para negocios",
      profileUrl: "https://www.youtube.com/@cuenta_demo",
    });
  });

  it("pide el ancho y el alto de cada video (fileDetails): sin eso ningun Short se reconoce", async () => {
    const fetchImpl = impl();
    await readYouTubeMetrics({ ...params, fetchImpl });

    const videos = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("/videos?"),
    );
    expect(String(videos?.[0])).toContain("fileDetails");
  });

  it("el tipo lo dice YouTube (la direccion /shorts/), no el tamaño del archivo", async () => {
    // Sin fileDetails, un Short quedaba como video.
    const fetchImpl = routed(
      [
        [/\/channels\?/, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] }],
        [/playlistItems/, { items: [{ contentDetails: { videoId: "s1" } }, { contentDetails: { videoId: "c1" } }, { contentDetails: { videoId: "v1" } }] }],
        [
          /\/videos\?/,
          {
            items: [
              { id: "s1", snippet: { publishedAt: "2025-08-30T01:59:13Z" }, contentDetails: { duration: "PT40S" } },
              { id: "c1", snippet: { publishedAt: "2025-08-01T01:59:13Z" }, contentDetails: { duration: "PT50S" } },
              { id: "v1", snippet: { publishedAt: "2026-06-22T23:00:36Z" }, contentDetails: { duration: "PT20M" } },
            ],
          },
        ],
      ],
      ["s1"],
    );

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts.map((p) => [p.externalPostId, p.mediaType])).toEqual([
      ["s1", "short"],
      // Corto pero no es Short (un video horizontal de 50 segundos): manda YouTube.
      ["c1", "video"],
      ["v1", "video"],
    ]);
    // Uno de 20 minutos no puede ser Short: no se pregunta.
    const checked = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/shorts/"));
    expect(checked).toEqual(["https://www.youtube.com/shorts/s1", "https://www.youtube.com/shorts/c1"]);
  });

  it("si YouTube no lo dice, decide el archivo: vertical y corto es Short", async () => {
    const base = impl();
    // La direccion /shorts/ no responde (la red caida, por ejemplo).
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/shorts/")) throw new Error("sin red");
      return base(url, init);
    }) as unknown as typeof fetch;

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts.find((p) => p.externalPostId === "v2")?.mediaType).toBe("short");
  });

  it("una transmision que nunca salio al aire y un video privado no se devuelven: se ocultan", async () => {
    const fetchImpl = routed([
      [/\/channels\?/, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] }],
      [
        /playlistItems/,
        {
          items: [
            { contentDetails: { videoId: "vivo" } },
            { contentDetails: { videoId: "privado" } },
            { contentDetails: { videoId: "v1" } },
          ],
        },
      ],
      [
        /\/videos\?/,
        {
          items: [
            { id: "vivo", snippet: { title: "Transmision en vivo" }, liveStreamingDetails: { scheduledStartTime: "2026-07-07T22:00:00Z" } },
            { id: "privado", status: { privacyStatus: "private" } },
            { id: "v1", status: { privacyStatus: "public" } },
          ],
        },
      ],
    ]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts.map((p) => p.externalPostId)).toEqual(["v1"]);
    expect(result.hiddenPostIds).toEqual(["vivo", "privado"]);
  });

  it("si falla el canal, lo avisa sin romper", async () => {
    const fetchImpl = routed([[/\/channels\?/, { error: { message: "sin permiso" } }]]);

    const result = await readYouTubeMetrics({ ...params, fetchImpl });

    expect(result.posts).toEqual([]);
    expect(result.warnings[0]).toContain("sin permiso");
  });
});

describe("los totales de la Data API (F44)", () => {
  it("los contadores vienen como texto y se leen como numero", () => {
    expect(count("413")).toBe(413);
    expect(count(7)).toBe(7);
  });

  it("uno que no vino queda en null, no en cero", () => {
    expect(count(undefined)).toBeNull();
    expect(count("")).toBeNull();
    expect(count("oculto")).toBeNull();
  });

  it("me gusta ocultos: null, no cero", () => {
    expect(statisticsToMetrics({ viewCount: "100", commentCount: "3" })).toMatchObject({
      views: 100,
      likes: null,
      comments: 3,
      engagementRate: 3,
    });
  });

  it("sin estadisticas no hay ningun numero", () => {
    expect(statisticsToMetrics(undefined)).toMatchObject({ views: null, likes: null, comments: null, engagementRate: null });
  });
});

describe("desde cuando pedirle a Analytics (F44)", () => {
  const details = (...dates: Array<string | null>) =>
    new Map(dates.map((publishedAt, i) => [`v${i}`, { publishedAt }]));

  it("el dia del video mas viejo", () => {
    expect(reportStartDate("2026-09-10", details("2026-07-07T18:00:00Z", "2025-05-24T10:00:00Z"))).toBe("2025-05-24");
  });

  it("si todos son mas nuevos que la ventana, la ventana", () => {
    expect(reportStartDate("2026-09-10", details("2026-09-20T10:00:00Z"))).toBe("2026-09-10");
  });

  it("una fecha que falta o no se entiende no mueve nada", () => {
    expect(reportStartDate("2026-09-10", details(null, "mañana"))).toBe("2026-09-10");
  });
});

describe("el perfil del canal (F44)", () => {
  it("sin @ usa el link por id", () => {
    expect(channelProfile("UC1", { title: "Canal" })).toMatchObject({
      username: null,
      avatarUrl: null,
      profileUrl: "https://www.youtube.com/channel/UC1",
    });
  });
});

describe("el tamaño del video (F44)", () => {
  it("un video de celular marcado como rotado se gira", () => {
    // Grabado apaisado con marca de rotacion: se ve vertical.
    expect(streamSize({ widthPixels: 1920, heightPixels: 1080, rotation: "clockwise" })).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("sin rotacion queda como vino", () => {
    expect(streamSize({ widthPixels: 1080, heightPixels: 1920, rotation: "none" })).toEqual({ width: 1080, height: 1920 });
  });

  it("sin datos, null", () => {
    expect(streamSize(undefined)).toEqual({ width: null, height: null });
  });

  it("un video cuadrado y corto es Short", () => {
    expect(isShort({ durationSeconds: 50, width: 1080, height: 1080 })).toBe(true);
  });
});

describe("los errores de Google (F44)", () => {
  it("sin etiquetas HTML", () => {
    expect(plainError('The <code><a href="/x">videoId</a></code> parameter')).toBe("The videoId parameter");
  });
});

describe("que se ve en el canal", () => {
  it("una transmision que salio al aire si", () => {
    expect(isVisibleOnChannel({ liveStreamingDetails: { actualStartTime: "2026-07-07T22:05:00Z" } })).toBe(true);
  });

  it("un no listado si: es un video real", () => {
    expect(isVisibleOnChannel({ status: { privacyStatus: "unlisted" } })).toBe(true);
  });
});

describe("si es un Short, segun YouTube", () => {
  const respond = (status: number, location?: string) =>
    vi.fn(async () => ({ status, headers: new Headers(location ? { location } : {}) })) as unknown as typeof fetch;

  it("200 en /shorts/ es un Short", async () => {
    expect(await checkIsShort("a", respond(200))).toBe(true);
  });

  it("una redireccion a /watch es un video", async () => {
    expect(await checkIsShort("a", respond(303, "https://www.youtube.com/watch?v=a"))).toBe(false);
  });

  it("una redireccion a otro lado (consentimiento) o un error no dice nada", async () => {
    expect(await checkIsShort("a", respond(302, "https://consent.youtube.com/m"))).toBeNull();
    expect(await checkIsShort("a", respond(429))).toBeNull();
  });

  it("lo que no se supo, lo decide el archivo", () => {
    expect(mediaTypeFromFlag(true, "video")).toBe("short");
    expect(mediaTypeFromFlag(false, "short")).toBe("video");
    expect(mediaTypeFromFlag(undefined, "short")).toBe("short");
  });
});
