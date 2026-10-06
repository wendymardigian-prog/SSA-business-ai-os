import { describe, expect, it } from "vitest";
import type { Snapshot } from "./post-analysis";
import { pieceLeads, type LeadTouch } from "./piece-leads";
import {
  NO_METRICS_NOTICE,
  buildPiecePerformance,
  metricsAvailable,
  type PerformancePublication,
} from "./piece-performance";

const NOW = new Date("2026-10-06T12:00:00Z");

function isoDaysAgo(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/** Fotos diarias acumuladas desde el dia de la publicacion hasta `lastDay`. */
function snapshots(
  publishedAt: string,
  lastDay: number,
  make: (day: number) => Partial<Snapshot>,
): Snapshot[] {
  return Array.from({ length: lastDay + 1 }, (_, day) => {
    const d = new Date(publishedAt);
    d.setUTCDate(d.getUTCDate() + day);
    return {
      date: d.toISOString().slice(0, 10),
      views: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      ...make(day),
    };
  });
}

function instagram(overrides: Partial<PerformancePublication> = {}): PerformancePublication {
  const publishedAt = isoDaysAgo(10);
  return {
    socialPostId: "ig-1",
    platform: "instagram",
    mediaType: "reel",
    publishedAt,
    engagementD7: 5,
    snapshots: snapshots(publishedAt, 10, (d) => ({
      reach: 100 * (d + 1),
      likes: 10 * (d + 1),
      comments: 2 * (d + 1),
    })),
    ...overrides,
  };
}

function youtube(overrides: Partial<PerformancePublication> = {}): PerformancePublication {
  const publishedAt = isoDaysAgo(3);
  return {
    socialPostId: "yt-1",
    platform: "youtube",
    mediaType: "short",
    publishedAt,
    engagementD7: null,
    // YouTube no da alcance: da vistas.
    snapshots: snapshots(publishedAt, 3, (d) => ({ views: 50 * (d + 1), likes: 5 * (d + 1) })),
    ...overrides,
  };
}

const NO_PEERS: PerformancePublication[] = [];

describe("buildPiecePerformance (F102)", () => {
  it("una fila por red publicada, con la EDAD de cada publicacion", () => {
    const result = buildPiecePerformance({
      publications: [instagram(), youtube()],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(result.rows.map((r) => [r.platform, r.ageDays])).toEqual([
      ["instagram", 10],
      ["youtube", 3],
    ]);
  });

  it("la comparacion es a la MISMA EDAD: alcance e interacciones al dia de la mas joven", () => {
    const result = buildPiecePerformance({
      publications: [instagram(), youtube()],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(result.commonAge).toBe(3);
    const [ig, yt] = result.rows;
    // Instagram a los 3 dias: la foto del dia 3 (alcance 400, interacciones 4×12).
    expect(ig.atCommonAge?.reach).toBe(400);
    expect(ig.atCommonAge?.interactions).toBe(48);
    // YouTube a los 3 dias: sus vistas (200) y sus me gusta (20).
    expect(yt.atCommonAge?.reach).toBe(200);
    expect(yt.atCommonAge?.interactions).toBe(20);
    // Lo de hoy sigue siendo lo de hoy, cada una a su edad.
    expect(ig.reach).toBe(1100);
    expect(yt.reach).toBe(200);
  });

  it("con una sola publicacion no hay edad comun: no hay con que comparar", () => {
    const result = buildPiecePerformance({
      publications: [instagram()],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(result.commonAge).toBeNull();
    expect(result.rows[0].atCommonAge).toBeNull();
  });

  it("alcance cae a las vistas cuando la red no da alcance, y lo marca", () => {
    const { rows } = buildPiecePerformance({
      publications: [instagram(), youtube()],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(rows[0].reachIsViews).toBe(false);
    expect(rows[1].reachIsViews).toBe(true);
  });

  it("LinkedIn muestra el AVISO de que no entrega metricas, nunca ceros", () => {
    const publishedAt = isoDaysAgo(12);
    const result = buildPiecePerformance({
      publications: [
        instagram(),
        {
          socialPostId: "li-1",
          platform: "linkedin",
          mediaType: "text",
          publishedAt,
          engagementD7: null,
          snapshots: [],
        },
      ],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    const linkedin = result.rows.find((r) => r.platform === "linkedin")!;
    expect(metricsAvailable("linkedin")).toBe(false);
    expect(linkedin.notice).toBe(NO_METRICS_NOTICE.linkedin);
    expect(linkedin.reach).toBeNull();
    expect(linkedin.interactions).toBeNull();
    expect(linkedin.engagementD7).toBeNull();
    expect(linkedin.index.status).toBe("no_data");
    expect(linkedin.index.value).toBeNull();
    // Y no cuenta para la edad comun ni para el promedio del indice de la pieza.
    expect(result.commonAge).toBeNull();
    expect(result.total.index.total).toBe(1);
  });

  it("una red con metricas pero sin ninguna foto todavia deja el hueco, no un cero", () => {
    const publishedAt = isoDaysAgo(1);
    const { rows } = buildPiecePerformance({
      publications: [{ ...youtube(), publishedAt, snapshots: [], socialPostId: "yt-2" }],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(rows[0].reach).toBeNull();
    expect(rows[0].interactions).toBeNull();
    expect(rows[0].notice).toBeNull();
  });

  it("el indice por red sale de F103 y el de la pieza promedia los que tienen", () => {
    // Tres vecinas de Instagram/reel con engagement 2, 4 y 6 (mediana 4), antes de la publicacion.
    const peers: PerformancePublication[] = [30, 40, 50].map((ago, i) => ({
      socialPostId: `peer-${i}`,
      platform: "instagram",
      mediaType: "reel",
      publishedAt: isoDaysAgo(ago),
      engagementD7: [2, 4, 6][i],
      snapshots: [],
    }));

    const result = buildPiecePerformance({
      publications: [instagram({ engagementD7: 7.2 }), youtube()],
      population: [...peers],
      leads: null,
      now: NOW,
    });

    const [ig, yt] = result.rows;
    expect(ig.index.value).toBe(1.8);
    // YouTube tiene 3 dias y ningun engagement a 7 dias: "en curso".
    expect(yt.index.status).toBe("in_progress");
    expect(result.total.index.value).toBe(1.8);
    expect(result.total.index.counted).toBe(1);
    expect(result.total.index.inProgress).toBe(1);
  });

  it("el total suma las crudas como CONTEXTO y promedia el engagement a 7 dias", () => {
    const result = buildPiecePerformance({
      publications: [
        instagram({ engagementD7: 5 }),
        instagram({
          socialPostId: "ig-2",
          platform: "tiktok",
          engagementD7: 3,
          snapshots: snapshots(isoDaysAgo(10), 10, (d) => ({ views: 10 * (d + 1), likes: d + 1 })),
        }),
      ],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    // 1100 de alcance + 110 de vistas.
    expect(result.total.reach).toBe(1210);
    expect(result.total.engagementD7).toBe(4);
    expect(result.total.publications).toBe(2);
  });

  it("deja afuera lo que no esta publicado", () => {
    const result = buildPiecePerformance({
      publications: [instagram({ publishedAt: null })],
      population: NO_PEERS,
      leads: null,
      now: NOW,
    });

    expect(result.rows).toEqual([]);
    expect(result.total.publications).toBe(0);
    expect(result.total.reach).toBeNull();
    expect(result.total.index.label).toBe("Sin datos");
  });

  describe("leads (F104)", () => {
    const comment = (contactId: string, socialPostId: string, at: string): LeadTouch => ({
      contactId,
      occurredAt: at,
      origin: "comment",
      medium: "comment",
      socialPostId,
      contentPostId: "piece-1",
    });

    it("por red y en el total sin contar dos veces a la misma persona", () => {
      const leads = pieceLeads({
        pieceId: "piece-1",
        publicationIds: ["ig-1", "yt-1"],
        touches: [
          comment("a", "ig-1", "2026-09-30T10:00:00Z"),
          // La misma persona comento tambien la otra publicacion, despues.
          comment("a", "yt-1", "2026-10-02T10:00:00Z"),
          comment("b", "ig-1", "2026-10-01T10:00:00Z"),
        ],
      });

      const result = buildPiecePerformance({
        publications: [instagram(), youtube()],
        population: NO_PEERS,
        leads,
        now: NOW,
      });

      const [ig, yt] = result.rows;
      expect(ig.leads).toBe(2);
      // YouTube no vincula comentarios con contactos: hueco, no cero.
      expect(yt.leads).toBeNull();
      expect(result.total.leads).toBe(2);
    });

    it("el total viene de la pieza, no de sumar filas: incluye a quien llego por una publicacion que ya no esta", () => {
      const leads = pieceLeads({
        pieceId: "piece-1",
        publicationIds: ["ig-1"],
        touches: [
          comment("a", "ig-1", "2026-09-30T10:00:00Z"),
          // Su publicacion se borro, pero el toque guarda la pieza.
          comment("b", "sp-borrada", "2026-10-01T10:00:00Z"),
        ],
      });

      const result = buildPiecePerformance({
        publications: [instagram()],
        population: NO_PEERS,
        leads,
        now: NOW,
      });

      expect(result.rows[0].leads).toBe(1);
      expect(result.total.leads).toBe(2);
    });

    it("sin lectura de leads, todo queda en hueco", () => {
      const result = buildPiecePerformance({
        publications: [instagram()],
        population: NO_PEERS,
        leads: null,
        now: NOW,
      });

      expect(result.rows[0].leads).toBeNull();
      expect(result.total.leads).toBeNull();
    });

    it("una red que lo mide, ya publicada y sin leads: es un cero real", () => {
      const leads = pieceLeads({ pieceId: "piece-1", publicationIds: ["ig-1"], touches: [] });
      const result = buildPiecePerformance({
        publications: [instagram()],
        population: NO_PEERS,
        leads,
        now: NOW,
      });

      expect(result.rows[0].leads).toBe(0);
      expect(result.total.leads).toBe(0);
    });
  });
});
