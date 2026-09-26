/**
 * Las cuentas del dashboard de contenido organico (F48, F50, F53).
 */

import { describe, it, expect } from "vitest";
import {
  bucketOf,
  changePercent,
  computeKpis,
  followerGrowth,
  followersAtEnd,
  formatPerformance,
  freshness,
  lastByBucket,
  monthStart,
  publishActivity,
  sumByBucket,
  unavailableMetricsNote,
  weeklyD7,
  weekStart,
  type AccountDailyRow,
  type PostDailyRow,
  type PublishedPost,
} from "./content";

const daily = (over: Partial<PostDailyRow> & { date: string }): PostDailyRow => ({
  socialPostId: "sp-1",
  platform: "instagram",
  mediaType: "reel",
  views: null,
  impressions: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  ...over,
});

const account = (over: Partial<AccountDailyRow> & { date: string }): AccountDailyRow => ({
  platform: "instagram",
  followers: null,
  followersGained: null,
  followersLost: null,
  ...over,
});

const post = (over: Partial<PublishedPost> = {}): PublishedPost => ({
  socialPostId: "sp-1",
  platform: "instagram",
  mediaType: "reel",
  publishedAt: "2026-09-20T15:00:00Z",
  origin: "system",
  engagementD7: null,
  ...over,
});

describe("agrupar por dia, semana o mes (F48)", () => {
  it("la semana empieza el lunes", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    // Un domingo cae en la semana que arranco el lunes anterior.
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
  });

  it("el mes empieza el primero", () => {
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
  });

  it("por dia, el grupo es el dia", () => {
    expect(bucketOf("2026-10-01", "day")).toBe("2026-10-01");
  });
});

describe("sumar por grupo (F48)", () => {
  const rows = [
    { date: "2026-09-28", value: 10 },
    { date: "2026-09-29", value: 5 },
    { date: "2026-10-05", value: 7 },
  ];

  it("los totales de la semana son la suma de sus dias", () => {
    expect(sumByBucket(rows, "week")).toEqual([
      { bucket: "2026-09-28", value: 15 },
      { bucket: "2026-10-05", value: 7 },
    ]);
  });

  it("un dia sin dato no aporta un cero", () => {
    // Un cero dice "ese dia no paso nada", que es distinto de "no sabemos".
    expect(sumByBucket([{ date: "2026-09-28", value: null }], "day")).toEqual([]);
  });

  it("un grupo con algunos dias sin dato suma los que hay", () => {
    expect(
      sumByBucket(
        [
          { date: "2026-09-28", value: 10 },
          { date: "2026-09-29", value: null },
        ],
        "week",
      ),
    ).toEqual([{ bucket: "2026-09-28", value: 10 }]);
  });
});

describe("los seguidores se toman, no se suman (F48)", () => {
  it("la semana es el ULTIMO dia, no la suma", () => {
    // Sumarlos daria la cifra multiplicada por la cantidad de dias: tres mil
    // seguidores donde hay mil.
    const result = lastByBucket(
      [
        { date: "2026-09-28", value: 1000 },
        { date: "2026-09-30", value: 1020 },
        { date: "2026-10-01", value: 1015 },
        { date: "2026-10-06", value: 1040 },
      ],
      "week",
    );

    expect(result).toEqual([
      { bucket: "2026-09-28", value: 1015 },
      { bucket: "2026-10-05", value: 1040 },
    ]);
  });

  it("el total al final del periodo, por red", () => {
    const totals = followersAtEnd([
      account({ date: "2026-09-30", followers: 1000 }),
      account({ date: "2026-10-01", followers: 1020 }),
      account({ date: "2026-10-01", platform: "threads", followers: 300 }),
    ]);

    expect(totals.get("instagram")).toBe(1020);
    expect(totals.get("threads")).toBe(300);
  });
});

describe("variacion contra el periodo anterior (F48)", () => {
  it("se calcula en porcentaje", () => {
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(80, 100)).toBe(-20);
  });

  it("sin dato anterior no hay variacion", () => {
    // "Crecio 100%" desde cero es una afirmacion vacia que se lee como logro.
    expect(changePercent(120, null)).toBeNull();
    expect(changePercent(120, 0)).toBeNull();
  });
});

describe("las cinco cifras de arriba (F48)", () => {
  const input = {
    posts: [post(), post({ socialPostId: "sp-2" })],
    postDaily: [
      daily({ date: "2026-10-01", reach: 1000, likes: 80, comments: 20, extra: { follows: 6 } }),
      daily({ date: "2026-10-01", socialPostId: "sp-2", reach: 500, likes: 20 }),
    ],
    accountDaily: [account({ date: "2026-10-01", followers: 1020 })],
    previous: {
      posts: [post()],
      postDaily: [daily({ date: "2026-09-01", reach: 800, likes: 40 })],
      accountDaily: [account({ date: "2026-09-30", followers: 1000 })],
    },
  };

  it("cuenta seguidores, alcance, publicaciones, engagement y follows", () => {
    const kpis = computeKpis(input);
    const by = Object.fromEntries(kpis.map((k) => [k.key, k]));

    expect(by.followers.value).toBe(1020);
    expect(by.followers.changePercent).toBe(2);
    expect(by.reach.value).toBe(1500);
    expect(by.posts.value).toBe(2);
    expect(by.follows.value).toBe(6);
  });

  it("el engagement es el promedio de los posts, no del periodo entero", () => {
    // Un post viral no tiene que tapar a los otros diez.
    const kpis = computeKpis(input);
    const engagement = kpis.find((k) => k.key === "engagement")!;

    // sp-1: 100/1000 = 10%. sp-2: 20/500 = 4%. Promedio: 7%.
    expect(engagement.value).toBe(7);
  });

  it("sin datos, los valores son null y no cero", () => {
    const kpis = computeKpis({
      posts: [],
      postDaily: [],
      accountDaily: [],
      previous: { posts: [], postDaily: [], accountDaily: [] },
    });

    expect(kpis.find((k) => k.key === "reach")!.value).toBeNull();
    expect(kpis.find((k) => k.key === "posts")!.value).toBe(0);
  });
});

describe("crecimiento de seguidores (F48)", () => {
  it("cuando la red no separa ganados y perdidos, se derivan de la diferencia", () => {
    const growth = followerGrowth(
      [
        account({ date: "2026-09-28", followers: 1000 }),
        account({ date: "2026-09-29", followers: 1012 }),
        account({ date: "2026-09-30", followers: 1007 }),
      ],
      "day",
    );

    expect(growth[1]).toMatchObject({ gained: 12, lost: 0, total: 1012 });
    expect(growth[2]).toMatchObject({ gained: 0, lost: 5, total: 1007 });
  });

  it("cuando la red los da, se usan los suyos", () => {
    const growth = followerGrowth(
      [account({ date: "2026-09-28", followers: 1000, followersGained: 20, followersLost: 8 })],
      "day",
    );

    expect(growth[0]).toMatchObject({ gained: 20, lost: 8 });
  });

  it("por semana, los ganados suman y el total es el ultimo", () => {
    const growth = followerGrowth(
      [
        account({ date: "2026-09-28", followers: 1000, followersGained: 10, followersLost: 0 }),
        account({ date: "2026-09-29", followers: 1015, followersGained: 15, followersLost: 0 }),
      ],
      "week",
    );

    expect(growth[0]).toMatchObject({ gained: 25, total: 1015 });
  });
});

describe("actividad y formatos (F48)", () => {
  it("cuenta publicaciones por formato y grupo", () => {
    const activity = publishActivity(
      [
        post({ publishedAt: "2026-09-28T10:00:00Z", mediaType: "reel" }),
        post({ publishedAt: "2026-09-29T10:00:00Z", mediaType: "reel" }),
        post({ publishedAt: "2026-09-29T10:00:00Z", mediaType: "carousel" }),
      ],
      "week",
    );

    expect(activity[0]).toMatchObject({ bucket: "2026-09-28", total: 3 });
    expect(activity[0].byFormat).toEqual({ reel: 2, carousel: 1 });
  });

  it("el rendimiento por formato promedia alcance y engagement", () => {
    const latest = new Map([
      ["sp-1", daily({ date: "2026-10-01", reach: 1000, likes: 100 })],
      ["sp-2", daily({ date: "2026-10-01", reach: 500, likes: 25 })],
    ]);

    const performance = formatPerformance(
      [post({ socialPostId: "sp-1" }), post({ socialPostId: "sp-2" })],
      latest,
    );

    expect(performance[0]).toMatchObject({ format: "reel", posts: 2, avgReach: 750, avgEngagement: 7.5 });
  });

  it("un post sin metricas cuenta como publicacion pero no baja el promedio", () => {
    const performance = formatPerformance([post()], new Map());

    expect(performance[0]).toMatchObject({ posts: 1, avgReach: null, avgEngagement: null });
  });
});

describe("engagement a 7 dias por semana (F50)", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("promedia por red y por semana de publicacion", () => {
    const result = weeklyD7(
      [
        post({ publishedAt: "2026-09-07T10:00:00Z", engagementD7: 4 }),
        post({ publishedAt: "2026-09-09T10:00:00Z", engagementD7: 6 }),
        post({ publishedAt: "2026-09-09T10:00:00Z", platform: "threads", engagementD7: 2 }),
      ],
      now,
    );

    expect(result[0].byPlatform).toEqual({ instagram: 5, threads: 2 });
  });

  it("la semana con posts de menos de 7 dias se marca en curso", () => {
    // Si no, pareceria que el rendimiento se derrumbo esta semana.
    const result = weeklyD7([post({ publishedAt: "2026-09-29T10:00:00Z", engagementD7: null })], now);

    expect(result[0].inProgress).toBe(true);
  });

  it("una semana cerrada no se marca", () => {
    const result = weeklyD7([post({ publishedAt: "2026-09-07T10:00:00Z", engagementD7: 4 })], now);

    expect(result[0].inProgress).toBe(false);
  });
});

describe("que tan frescos son los datos (F53)", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("una red al dia lo dice", () => {
    const rows = freshness(
      [{ platform: "instagram", syncedAt: "2026-10-01T11:40:00Z", error: null }],
      new Map(),
      now,
    );

    expect(rows[0].label).toBe("Datos al dia.");
  });

  it("una que fallo muestra el ultimo dato bueno", () => {
    const rows = freshness(
      [{ platform: "youtube", syncedAt: "2026-10-01T03:00:00Z", error: "Cuota agotada" }],
      new Map([["youtube", "2026-09-29"]]),
      now,
    );

    expect(rows[0].label).toContain("2026-09-29");
    expect(rows[0].error).toBe("Cuota agotada");
  });

  it("una que nunca se actualizo lo dice", () => {
    const rows = freshness([{ platform: "threads", syncedAt: null, error: null }], new Map(), now);

    expect(rows[0].label).toBe("Todavia no se actualizo.");
  });
});

describe("una red sin metricas (F48)", () => {
  it("LinkedIn lo dice, con cuantas piezas se publicaron", () => {
    expect(unavailableMetricsNote("linkedin", 4)).toContain("4 piezas");
  });

  it("las otras redes no muestran nada", () => {
    expect(unavailableMetricsNote("instagram", 4)).toBeNull();
  });
});
