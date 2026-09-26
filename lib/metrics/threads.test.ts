/**
 * Lector de metricas de Threads (F44). API simulada.
 */

import { describe, it, expect, vi } from "vitest";
import { insightTotal, normalizeThreadsMetrics, readThreadsMetrics, threadsMediaType } from "./threads";

function routed(routes: Array<[RegExp, unknown]>) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    const hit = routes.find(([pattern]) => pattern.test(href));
    return { ok: true, status: 200, json: async () => hit?.[1] ?? { data: [] } };
  }) as unknown as typeof fetch;
}

const insights = (values: Record<string, number>) => ({
  data: Object.entries(values).map(([name, value]) => ({ name, total_value: { value } })),
});

describe("el total de un metric (F44)", () => {
  it("prefiere total_value", () => {
    expect(insightTotal({ name: "views", total_value: { value: 900 } })).toBe(900);
  });

  it("suma la serie si no hay total", () => {
    expect(insightTotal({ name: "views", values: [{ value: 3 }, { value: 4 }] })).toBe(7);
  });

  it("lo que no vino da null", () => {
    expect(insightTotal(undefined)).toBeNull();
    expect(insightTotal({ name: "views", values: [] })).toBeNull();
  });
});

describe("normalizar las metricas (F44)", () => {
  it("repostear y citar son las dos amplificacion: suman en shares", () => {
    const metrics = normalizeThreadsMetrics(
      insights({ views: 1000, likes: 50, replies: 10, reposts: 8, quotes: 2 }),
    );

    expect(metrics).toMatchObject({ views: 1000, likes: 50, comments: 10, shares: 10 });
    expect(metrics.extra).toEqual({ reposts: 8, quotes: 2 });
  });

  it("las impresiones quedan en null: Threads no las distingue de las vistas", () => {
    // Copiar el mismo numero en dos columnas seria inventar un dato.
    expect(normalizeThreadsMetrics(insights({ views: 1000 })).impressions).toBeNull();
  });

  it("la tasa sale sobre las vistas", () => {
    expect(normalizeThreadsMetrics(insights({ views: 200, likes: 20 })).engagementRate).toBe(10);
  });

  it("un payload vacio no inventa ceros", () => {
    expect(normalizeThreadsMetrics(null).views).toBeNull();
    expect(normalizeThreadsMetrics({ data: "roto" }).likes).toBeNull();
  });
});

describe("el tipo de media (F44)", () => {
  it("se traduce al vocabulario nuestro", () => {
    expect(threadsMediaType("CAROUSEL_ALBUM")).toBe("carousel");
    expect(threadsMediaType("TEXT_POST")).toBe("text");
    expect(threadsMediaType("OTRO")).toBeNull();
  });
});

describe("leer la cuenta (F44)", () => {
  const params = { token: "t", userId: "9" };

  it("trae cada post con sus metricas y los seguidores", async () => {
    const fetchImpl = routed([
      [/\/9\/threads\?/, { data: [{ id: "th-1", text: "Hola", permalink: "https://th/1", media_type: "TEXT_POST" }] }],
      [/th-1\/insights/, insights({ views: 500, likes: 30 })],
      [/threads_insights/, insights({ followers_count: 1200 })],
    ]);

    const result = await readThreadsMetrics({ ...params, fetchImpl });

    expect(result.posts[0]).toMatchObject({ externalPostId: "th-1", mediaType: "text" });
    expect(result.posts[0].metrics.views).toBe(500);
    expect(result.accountDaily[0].followers).toBe(1200);
  });

  it("un post cuyos insights fallan entra igual, con todo en null", async () => {
    const fetchImpl = routed([
      [/\/9\/threads\?/, { data: [{ id: "th-1" }] }],
      [/th-1\/insights/, { error: { message: "sin permiso" } }],
      [/threads_insights/, insights({ followers_count: 10 })],
    ]);

    const result = await readThreadsMetrics({ ...params, fetchImpl });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].metrics.views).toBeNull();
  });

  it("si falla la lista, lo avisa sin romper", async () => {
    const fetchImpl = routed([
      [/\/9\/threads\?/, { error: { message: "token vencido" } }],
      [/threads_insights/, { error: { message: "token vencido" } }],
    ]);

    const result = await readThreadsMetrics({ ...params, fetchImpl });

    expect(result.posts).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
