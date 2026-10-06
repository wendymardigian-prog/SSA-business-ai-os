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
  groupPerformance,
  lastByBucket,
  matchesClassification,
  monthStart,
  publishActivity,
  sumByBucket,
  sumTotals,
  unavailableMetricsNote,
  weeklyD7,
  weekStart,
  type AccountDailyRow,
  type PieceInfo,
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


// ── Agrupar y filtrar por pieza, oferta, pilar y embudo (F105) ────────────

describe("agrupar el rendimiento por la clasificacion de la pieza (F105)", () => {
  const piece = (over: Partial<PieceInfo> & { id: string }): PieceInfo => ({
    title: over.id,
    offerId: null,
    offerName: null,
    pillarId: null,
    pillarName: null,
    funnelStage: null,
    ...over,
  });

  // Dos piezas de la oferta "Mentoria", una sin oferta, y una publicada a mano.
  const pieces = new Map<string, PieceInfo>([
    ["pc-a", piece({ id: "pc-a", title: "Reel de dolares", offerId: "o-1", offerName: "Mentoria", pillarId: "p-1", pillarName: "Educativo", funnelStage: "tofu" })],
    ["pc-b", piece({ id: "pc-b", title: "Carrusel de errores", offerId: "o-1", offerName: "Mentoria", pillarId: "p-2", pillarName: "Autoridad", funnelStage: "mofu" })],
    ["pc-c", piece({ id: "pc-c", title: "Una sin oferta" })],
  ]);

  const posts: PublishedPost[] = [
    post({ socialPostId: "a-ig", contentPostId: "pc-a", platform: "instagram", mediaType: "reel", engagementD7: 4 }),
    post({ socialPostId: "a-tt", contentPostId: "pc-a", platform: "tiktok", mediaType: "video", engagementD7: 6 }),
    post({ socialPostId: "b-ig", contentPostId: "pc-b", platform: "instagram", mediaType: "carousel", engagementD7: 2 }),
    post({ socialPostId: "c-ig", contentPostId: "pc-c", platform: "instagram", mediaType: "reel" }),
    post({ socialPostId: "x-ig", contentPostId: null, origin: "external", platform: "instagram", mediaType: null }),
  ];

  const latest = new Map<string, PostDailyRow>([
    ["a-ig", daily({ socialPostId: "a-ig", date: "2026-10-01", reach: 1000, likes: 100 })],
    ["a-tt", daily({ socialPostId: "a-tt", date: "2026-10-01", views: 500, likes: 25 })],
    ["b-ig", daily({ socialPostId: "b-ig", date: "2026-10-01", reach: 300, likes: 15, comments: 5 })],
    ["c-ig", daily({ socialPostId: "c-ig", date: "2026-10-01", reach: 200, likes: 10 })],
    ["x-ig", daily({ socialPostId: "x-ig", date: "2026-10-01", reach: 100, likes: 1 })],
  ]);

  const group = (dimension: Parameters<typeof groupPerformance>[0]["dimension"], leadsByPost: Map<string, number> | null = null) =>
    groupPerformance({ posts, latestByPost: latest, pieces, leadsByPost, dimension });

  const row = (rows: ReturnType<typeof group>, key: string) => rows.find((r) => r.key === key)!;

  it("por oferta, el total coincide con la suma de las piezas de esa oferta", () => {
    const byOffer = group("offer");
    const byPiece = group("piece");

    const mentoria = row(byOffer, "o-1");
    const piecesOfMentoria = [row(byPiece, "pc-a"), row(byPiece, "pc-b")];

    expect(mentoria.label).toBe("Mentoria");
    expect(mentoria.posts).toBe(3);
    expect(mentoria.pieces).toBe(2);
    expect(mentoria.posts).toBe(piecesOfMentoria.reduce((sum, r) => sum + r.posts, 0));
    // 1000 de alcance + 500 de vistas + 300 de alcance.
    expect(mentoria.reach).toBe(1800);
    expect(mentoria.reach).toBe(piecesOfMentoria.reduce((sum, r) => sum + (r.reach ?? 0), 0));
    expect(mentoria.interactions).toBe(100 + 25 + 15 + 5);
  });

  it("una pieza sin oferta aparece en 'Sin asignar' y no desaparece del total", () => {
    const byOffer = group("offer");
    const none = row(byOffer, "none");

    expect(none.label).toBe("Sin asignar");
    expect(none.unassigned).toBe(true);
    // La pieza sin oferta (1) y la publicada a mano (1).
    expect(none.posts).toBe(2);
    // Ninguna publicacion se pierde: la suma de las filas es el total de posts.
    expect(byOffer.reduce((sum, r) => sum + r.posts, 0)).toBe(posts.length);
  });

  it("lo publicado a mano (sin pieza) cae en 'Sin asignar' tambien al agrupar por pieza", () => {
    const byPiece = group("piece");

    expect(byPiece.reduce((sum, r) => sum + r.posts, 0)).toBe(posts.length);
    expect(row(byPiece, "none").posts).toBe(1);
    expect(row(byPiece, "pc-a").label).toBe("Reel de dolares");
  });

  it("por pilar y por etapa del embudo, lo que no tiene va a 'Sin asignar'", () => {
    const byPillar = group("pillar");
    expect(row(byPillar, "p-1").posts).toBe(2);
    expect(row(byPillar, "p-2").posts).toBe(1);
    expect(row(byPillar, "none").posts).toBe(2);

    const byFunnel = group("funnel");
    expect(row(byFunnel, "tofu").label).toBe("Descubrimiento");
    expect(row(byFunnel, "mofu").label).toBe("Consideración");
    expect(row(byFunnel, "none").posts).toBe(2);
    expect(byFunnel.reduce((sum, r) => sum + r.posts, 0)).toBe(posts.length);
  });

  it("por red y por formato usa lo de CADA publicacion, no el formato principal de la pieza", () => {
    const byPlatform = group("platform");
    expect(row(byPlatform, "instagram").label).toBe("Instagram");
    expect(row(byPlatform, "instagram").posts).toBe(4);
    expect(row(byPlatform, "tiktok").posts).toBe(1);

    const byFormat = group("format");
    // La pieza A salio como reel en Instagram y como video en TikTok: dos filas.
    expect(row(byFormat, "reel").posts).toBe(2);
    expect(row(byFormat, "video").posts).toBe(1);
    expect(row(byFormat, "carousel").posts).toBe(1);
    expect(row(byFormat, "none").posts).toBe(1);
  });

  it("promedia el engagement a 7 dias solo de las que ya lo tienen", () => {
    const mentoria = row(group("offer"), "o-1");
    expect(mentoria.avgEngagementD7).toBe(4);
    expect(row(group("offer"), "none").avgEngagementD7).toBeNull();
  });

  it("'Sin asignar' va siempre al final, aunque tenga mas publicaciones", () => {
    const many = [...posts, post({ socialPostId: "y", contentPostId: null }), post({ socialPostId: "z", contentPostId: null })];
    const rows = groupPerformance({
      posts: many,
      latestByPost: latest,
      pieces,
      leadsByPost: null,
      dimension: "offer",
    });

    expect(rows[rows.length - 1].key).toBe("none");
  });

  it("los leads suman solo donde la red los mide, y sin lectura quedan en hueco", () => {
    const leads = new Map([["a-ig", 3], ["b-ig", 1]]);
    const byOffer = group("offer", leads);

    // a-ig (3) + b-ig (1); a-tt es TikTok: tambien se mide y no tiene leads.
    expect(row(byOffer, "o-1").leads).toBe(4);
    expect(row(byOffer, "none").leads).toBe(0);

    expect(row(group("offer", null), "o-1").leads).toBeNull();

    // Una red que no vincula comentarios no aporta un cero.
    const onlyYoutube = groupPerformance({
      posts: [post({ socialPostId: "yt", platform: "youtube", contentPostId: "pc-c" })],
      latestByPost: new Map(),
      pieces,
      leadsByPost: new Map(),
      dimension: "piece",
    });
    expect(onlyYoutube[0].leads).toBeNull();
  });

  it("una publicacion sin metricas cuenta como publicacion pero no baja el promedio ni inventa ceros", () => {
    const rows = groupPerformance({
      posts: [post({ socialPostId: "n1", contentPostId: "pc-c" })],
      latestByPost: new Map(),
      pieces,
      leadsByPost: null,
      dimension: "piece",
    });

    expect(rows[0].posts).toBe(1);
    expect(rows[0].reach).toBeNull();
    expect(rows[0].avgEngagement).toBeNull();
  });
});

describe("filtrar publicaciones por la clasificacion de su pieza (F105)", () => {
  const pieces = new Map<string, PieceInfo>([
    ["pc-a", { id: "pc-a", title: "A", offerId: "o-1", offerName: "Mentoria", pillarId: "p-1", pillarName: "Educativo", funnelStage: "tofu" }],
    ["pc-c", { id: "pc-c", title: "C", offerId: null, offerName: null, pillarId: null, pillarName: null, funnelStage: null }],
  ]);
  const withA = post({ contentPostId: "pc-a", mediaType: "reel" });
  const withC = post({ contentPostId: "pc-c", mediaType: "carousel" });
  const external = post({ contentPostId: null, mediaType: null });

  it("sin filtros pasa todo", () => {
    expect([withA, withC, external].every((p) => matchesClassification(p, pieces, {}))).toBe(true);
  });

  it("por oferta, pilar y embudo", () => {
    expect(matchesClassification(withA, pieces, { offer: "o-1" })).toBe(true);
    expect(matchesClassification(withC, pieces, { offer: "o-1" })).toBe(false);
    expect(matchesClassification(withA, pieces, { pillar: "p-1", funnel: "tofu" })).toBe(true);
    expect(matchesClassification(withA, pieces, { pillar: "p-1", funnel: "bofu" })).toBe(false);
  });

  it("'none' elige lo SIN asignar: la pieza sin oferta y lo publicado a mano", () => {
    expect(matchesClassification(withC, pieces, { offer: "none" })).toBe(true);
    expect(matchesClassification(external, pieces, { offer: "none" })).toBe(true);
    expect(matchesClassification(withA, pieces, { offer: "none" })).toBe(false);
  });

  it("por pieza y por formato de la publicacion", () => {
    expect(matchesClassification(withA, pieces, { piece: "pc-a" })).toBe(true);
    expect(matchesClassification(withC, pieces, { piece: "pc-a" })).toBe(false);
    expect(matchesClassification(withA, pieces, { format: "reel" })).toBe(true);
    expect(matchesClassification(withC, pieces, { format: "reel" })).toBe(false);
    expect(matchesClassification(external, pieces, { format: "none" })).toBe(true);
  });

  it("una publicacion cuya pieza ya no se conoce se trata como sin asignar", () => {
    const orphan = post({ contentPostId: "se-borro" });
    expect(matchesClassification(orphan, pieces, { offer: "none" })).toBe(true);
    expect(matchesClassification(orphan, pieces, { offer: "o-1" })).toBe(false);
  });
});

describe("el total de la tabla agrupada (F105)", () => {
  it("es la suma de las filas y deja el hueco cuando ninguna tiene el dato", () => {
    const row = (over: Partial<ReturnType<typeof groupPerformance>[number]>) => ({
      key: "k",
      label: "k",
      unassigned: false,
      posts: 0,
      pieces: 0,
      reach: null,
      interactions: null,
      avgEngagement: null,
      avgEngagementD7: null,
      leads: null,
      ...over,
    });

    expect(sumTotals([row({ posts: 2, reach: 10, leads: 1 }), row({ posts: 3, reach: 5 })])).toEqual({
      posts: 5,
      reach: 15,
      interactions: null,
      leads: 1,
    });
    expect(sumTotals([]).reach).toBeNull();
  });
});
