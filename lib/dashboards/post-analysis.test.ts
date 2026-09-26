/**
 * El analisis historico de un post (F51).
 */

import { describe, it, expect } from "vitest";
import {
  ageLabel,
  benchmark,
  evolution,
  metricCards,
  metricOf,
  reachAudience,
  type Snapshot,
} from "./post-analysis";

const snap = (over: Partial<Snapshot> & { date: string }): Snapshot => ({
  views: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  ...over,
});

const PUBLISHED = "2026-10-01T12:00:00Z";

describe("leer una metrica (F51)", () => {
  it("las interacciones son la suma de las cuatro", () => {
    expect(
      metricOf(snap({ date: "d", likes: 10, comments: 3, shares: 2, saves: 5 }), "interactions"),
    ).toBe(20);
  });

  it("sin ninguna, no hay interacciones: null y no cero", () => {
    expect(metricOf(snap({ date: "d" }), "interactions")).toBeNull();
  });
});

describe("la evolucion desde la publicacion (F51)", () => {
  it("las barras son lo nuevo de cada dia, sacado del acumulado", () => {
    const points = evolution({
      publishedAt: PUBLISHED,
      snapshots: [
        snap({ date: "2026-10-01", views: 100 }),
        snap({ date: "2026-10-02", views: 260 }),
        snap({ date: "2026-10-03", views: 300 }),
      ],
      metric: "views",
    });

    expect(points.map((p) => p.added)).toEqual([100, 160, 40]);
    expect(points.map((p) => p.cumulative)).toEqual([100, 260, 300]);
  });

  it("una foto que falta se reparte y se marca como estimada", () => {
    // Atribuirle los tres dias al ultimo inventaria un pico.
    const points = evolution({
      publishedAt: PUBLISHED,
      snapshots: [snap({ date: "2026-10-01", views: 100 }), snap({ date: "2026-10-04", views: 400 })],
      metric: "views",
    });

    const estimated = points.filter((p) => p.estimated);
    expect(estimated).toHaveLength(3);
    expect(estimated.every((p) => p.added === 100)).toBe(true);
  });

  it("un acumulado que baja suma cero, nunca un negativo", () => {
    // Es una correccion de la red, no gente que se arrepintio.
    const points = evolution({
      publishedAt: PUBLISHED,
      snapshots: [snap({ date: "2026-10-01", views: 500 }), snap({ date: "2026-10-02", views: 480 })],
      metric: "views",
    });

    expect(points[1].added).toBe(0);
  });

  it("los dias se cuentan desde la publicacion", () => {
    const points = evolution({
      publishedAt: PUBLISHED,
      snapshots: [snap({ date: "2026-10-01", views: 10 }), snap({ date: "2026-10-05", views: 50 })],
      metric: "views",
    });

    expect(points[0].day).toBe(0);
    expect(points.at(-1)?.day).toBe(4);
  });

  it("una metrica que ese post no tiene no dibuja nada", () => {
    expect(
      evolution({
        publishedAt: PUBLISHED,
        snapshots: [snap({ date: "2026-10-01", views: 100 })],
        metric: "saves",
      }),
    ).toEqual([]);
  });
});

describe("la linea de comparacion (F51)", () => {
  it("promedia los posts del mismo formato a la misma edad", () => {
    // Sin ella, 400 vistas al dia 3 no se sabe si va bien o mal.
    const result = benchmark({
      peers: [
        {
          publishedAt: "2026-09-01T00:00:00Z",
          snapshots: [snap({ date: "2026-09-01", views: 100 }), snap({ date: "2026-09-02", views: 300 })],
        },
        {
          publishedAt: "2026-09-10T00:00:00Z",
          snapshots: [snap({ date: "2026-09-10", views: 200 }), snap({ date: "2026-09-11", views: 500 })],
        },
      ],
      metric: "views",
      maxDay: 2,
    });

    expect(result[0].value).toBe(150);
    expect(result[1].value).toBe(400);
  });

  it("un dia sin ningun post comparable queda en null", () => {
    const result = benchmark({
      peers: [{ publishedAt: "2026-09-01T00:00:00Z", snapshots: [snap({ date: "2026-09-01", views: 100 })] }],
      metric: "views",
      maxDay: 3,
    });

    expect(result[3].value).toBeNull();
  });

  it("sin posts comparables, todo en null", () => {
    expect(benchmark({ peers: [], metric: "views", maxDay: 1 })).toEqual([
      { day: 0, value: null },
      { day: 1, value: null },
    ]);
  });
});

describe("la grilla de metricas (F51)", () => {
  const latest = snap({ date: "2026-10-05", reach: 1000, likes: 80, comments: 15, shares: 5, saves: 20 });

  it("calcula el engagement sobre el alcance", () => {
    const cards = metricCards({
      platform: "instagram",
      latest,
      engagementD7: 9.5,
      daysSincePublished: 10,
    });

    expect(cards.find((c) => c.key === "engagement")?.value).toBe(12);
    expect(cards.find((c) => c.key === "engagement_d7")?.value).toBe(9.5);
  });

  it("YouTube no tiene guardados y lo dice, en vez de mostrar un cero", () => {
    // Un cero diria que nadie guardo el video.
    const cards = metricCards({
      platform: "youtube",
      latest,
      engagementD7: null,
      daysSincePublished: 30,
    });

    const saves = cards.find((c) => c.key === "saves")!;
    expect(saves.value).toBeNull();
    expect(saves.note).toContain("no informa");
  });

  it("antes de los 7 dias, el engagement comparable dice 'en curso'", () => {
    const cards = metricCards({
      platform: "instagram",
      latest,
      engagementD7: null,
      daysSincePublished: 3,
    });

    expect(cards.find((c) => c.key === "engagement_d7")?.note).toBe("En curso");
  });

  it("sin foto, todo en null sin romper", () => {
    const cards = metricCards({
      platform: "instagram",
      latest: null,
      engagementD7: null,
      daysSincePublished: 1,
    });

    expect(cards.every((c) => c.value === null)).toBe(true);
  });
});

describe("alcance por audiencia (F51)", () => {
  it("con mayoria de no seguidores, lo dice en palabras", () => {
    // "70% no seguidores" solo no dice nada; esto si.
    const result = reachAudience({ reach_followers: 300, reach_non_followers: 700 });

    expect(result?.nonFollowerShare).toBe(70);
    expect(result?.label).toContain("gente nueva");
  });

  it("con casi todo entre seguidores, tambien", () => {
    expect(reachAudience({ reach_followers: 900, reach_non_followers: 100 })?.label).toContain(
      "ya te siguen",
    );
  });

  it("sin el dato, no se muestra la seccion", () => {
    expect(reachAudience(null)).toBeNull();
    expect(reachAudience({ reach_followers: 100 })).toBeNull();
  });
});

describe("la edad del post (F51)", () => {
  const now = new Date("2026-10-10T00:00:00Z");

  it("se dice en palabras", () => {
    expect(ageLabel("2026-10-10T00:00:00Z", now)).toBe("Hoy");
    expect(ageLabel("2026-10-09T00:00:00Z", now)).toBe("Ayer");
    expect(ageLabel("2026-10-01T00:00:00Z", now)).toBe("Hace 9 dias");
    expect(ageLabel("2026-08-01T00:00:00Z", now)).toBe("Hace 2 meses");
  });

  it("sin fecha lo dice en vez de calcular sobre la nada", () => {
    expect(ageLabel(null, now)).toBe("Sin fecha");
  });
});
