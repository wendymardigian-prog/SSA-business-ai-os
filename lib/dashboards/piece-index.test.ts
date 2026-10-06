import { describe, expect, it } from "vitest";
import { BUMP_THRESHOLD, median } from "./follower-bump";
import {
  INDEX_BASE_MIN,
  INDEX_LOW,
  INDEX_WINDOW_DAYS,
  formatIndex,
  pieceIndex,
  publicationIndex,
  type IndexPublication,
} from "./piece-index";

const NOW = new Date("2026-10-06T12:00:00Z");

function day(offset: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
}

function pub(overrides: Partial<IndexPublication> & { socialPostId: string }): IndexPublication {
  return {
    platform: "instagram",
    mediaType: "reel",
    publishedAt: day(-20),
    engagementD7: 4,
    ...overrides,
  };
}

/** Tres vecinas comparables de Instagram/reel con engagement 2, 4 y 6 (mediana 4). */
function peers(): IndexPublication[] {
  return [
    pub({ socialPostId: "p1", publishedAt: day(-30), engagementD7: 2 }),
    pub({ socialPostId: "p2", publishedAt: day(-40), engagementD7: 4 }),
    pub({ socialPostId: "p3", publishedAt: day(-50), engagementD7: 6 }),
  ];
}

describe("publicationIndex (F103)", () => {
  it("se compara contra la MEDIANA de la misma red y el mismo formato", () => {
    const target = pub({ socialPostId: "t", engagementD7: 7.2 });
    const result = publicationIndex(target, [target, ...peers()], NOW);

    expect(result.status).toBe("ok");
    expect(result.median).toBe(4);
    expect(result.comparables).toBe(3);
    expect(result.value).toBe(1.8);
    expect(formatIndex(result.value)).toBe("1,8×");
  });

  it("con DOS publicaciones comparables no hay indice: 'base insuficiente' y los crudos a la vista", () => {
    const target = pub({ socialPostId: "t", engagementD7: 7.2 });
    const result = publicationIndex(target, [target, ...peers().slice(0, 2)], NOW);

    expect(INDEX_BASE_MIN).toBe(3);
    expect(result.status).toBe("insufficient");
    expect(result.value).toBeNull();
    expect(result.tone).toBeNull();
    expect(result.label).toBe("Base insuficiente");
    expect(result.comparables).toBe(2);
    // El numero crudo de la publicacion queda visible: es contexto.
    expect(result.engagement).toBe(7.2);
  });

  it("no cuenta como comparable otra red, otro formato, una fuera de ventana ni una sin engagement a 7 dias", () => {
    const target = pub({ socialPostId: "t", engagementD7: 8 });
    const noise: IndexPublication[] = [
      pub({ socialPostId: "n1", platform: "tiktok", publishedAt: day(-25), engagementD7: 4 }),
      pub({ socialPostId: "n2", mediaType: "carousel", publishedAt: day(-26), engagementD7: 4 }),
      pub({ socialPostId: "n3", publishedAt: day(-20 - INDEX_WINDOW_DAYS - 1), engagementD7: 4 }),
      pub({ socialPostId: "n4", publishedAt: day(-27), engagementD7: null }),
      // Salio DESPUES de la publicacion que se mide: no es "lo normal de antes".
      pub({ socialPostId: "n5", publishedAt: day(-5), engagementD7: 4 }),
    ];
    const result = publicationIndex(target, [target, ...peers().slice(0, 2), ...noise], NOW);

    expect(result.comparables).toBe(2);
    expect(result.status).toBe("insufficient");
  });

  it("la ventana es de 90 dias previos a la publicacion: el dia 90 entra y el 91 no", () => {
    const target = pub({ socialPostId: "t", publishedAt: day(-10), engagementD7: 5 });
    const edge = (id: string, back: number) =>
      pub({ socialPostId: id, publishedAt: day(-10 - back), engagementD7: 5 });

    const inside = publicationIndex(
      target,
      [target, edge("a", 90), edge("b", 60), edge("c", 30)],
      NOW,
    );
    expect(inside.comparables).toBe(3);

    const outside = publicationIndex(
      target,
      [target, edge("a", 91), edge("b", 60), edge("c", 30)],
      NOW,
    );
    expect(outside.comparables).toBe(2);
  });

  it("la publicacion que se mide nunca es su propia comparable", () => {
    const target = pub({ socialPostId: "t", engagementD7: 4 });
    const result = publicationIndex(target, [target, ...peers().slice(0, 2)], NOW);
    expect(result.comparables).toBe(2);
  });

  it("usa el mismo criterio de mediana que el salto de seguidores (con cantidad par, el promedio de los dos del medio)", () => {
    const four = [
      ...peers(),
      pub({ socialPostId: "p4", publishedAt: day(-60), engagementD7: 8 }),
    ];
    const target = pub({ socialPostId: "t", engagementD7: 10 });
    const result = publicationIndex(target, [target, ...four], NOW);

    expect(result.median).toBe(median([2, 4, 6, 8]));
    expect(result.median).toBe(5);
    expect(result.value).toBe(2);
  });

  it("verde desde 1,5×, rojo por debajo de 0,8× y neutro en el medio", () => {
    expect(INDEX_LOW).toBe(0.8);
    const at = (d7: number) =>
      publicationIndex(pub({ socialPostId: "t", engagementD7: d7 }), [...peers()], NOW);

    // 4 × 1,5 = 6 → justo en el umbral: verde.
    expect(at(4 * BUMP_THRESHOLD).tone).toBe("good");
    expect(at(5.9).tone).toBe("neutral");
    // 4 × 0,8 = 3,2 → justo en el umbral: neutro (rojo es POR DEBAJO).
    expect(at(3.2).tone).toBe("neutral");
    expect(at(3.1).tone).toBe("bad");
  });

  it("sin engagement a 7 dias y con menos de 7 dias de edad: 'en curso'", () => {
    const target = pub({ socialPostId: "t", publishedAt: day(-3), engagementD7: null });
    const result = publicationIndex(target, [target, ...peers()], NOW);

    expect(result.status).toBe("in_progress");
    expect(result.label).toBe("En curso");
    expect(result.value).toBeNull();
  });

  it("sin engagement a 7 dias pero con mas de 7 dias de edad: 'sin dato', no 'en curso' para siempre", () => {
    const target = pub({ socialPostId: "t", publishedAt: day(-20), engagementD7: null });
    const result = publicationIndex(target, [target, ...peers()], NOW);

    expect(result.status).toBe("no_data");
    expect(result.label).toBe("Sin dato");
  });

  it("una base de mediana cero no se divide: base insuficiente", () => {
    const zeros = [
      pub({ socialPostId: "z1", publishedAt: day(-30), engagementD7: 0 }),
      pub({ socialPostId: "z2", publishedAt: day(-40), engagementD7: 0 }),
      pub({ socialPostId: "z3", publishedAt: day(-50), engagementD7: 0 }),
    ];
    const result = publicationIndex(pub({ socialPostId: "t", engagementD7: 5 }), zeros, NOW);

    expect(result.status).toBe("insufficient");
    expect(result.value).toBeNull();
  });

  it("una publicacion sin fecha no tiene indice", () => {
    const result = publicationIndex(
      pub({ socialPostId: "t", publishedAt: null, engagementD7: 5 }),
      peers(),
      NOW,
    );
    expect(result.status).toBe("no_data");
  });
});

describe("pieceIndex (F103)", () => {
  const ok = (value: number) =>
    publicationIndex(
      pub({ socialPostId: `t${value}`, engagementD7: 4 * value }),
      peers(),
      NOW,
    );

  it("es el promedio de los indices de sus publicaciones", () => {
    const result = pieceIndex([ok(2), ok(1)]);

    expect(result.value).toBe(1.5);
    expect(result.tone).toBe("good");
    expect(result.counted).toBe(2);
    expect(result.total).toBe(2);
  });

  it("una publicacion 'en curso' queda FUERA del promedio y se avisa", () => {
    const inProgress = publicationIndex(
      pub({ socialPostId: "x", publishedAt: day(-2), engagementD7: null }),
      peers(),
      NOW,
    );
    const result = pieceIndex([ok(2), ok(1), inProgress]);

    expect(result.value).toBe(1.5);
    expect(result.counted).toBe(2);
    expect(result.total).toBe(3);
    expect(result.inProgress).toBe(1);
  });

  it("si ninguna publicacion tiene indice, la pieza no lo inventa", () => {
    const inProgress = publicationIndex(
      pub({ socialPostId: "x", publishedAt: day(-2), engagementD7: null }),
      peers(),
      NOW,
    );
    expect(pieceIndex([inProgress]).value).toBeNull();
    expect(pieceIndex([inProgress]).label).toBe("En curso");

    const few = publicationIndex(pub({ socialPostId: "y", engagementD7: 5 }), [], NOW);
    expect(pieceIndex([few]).value).toBeNull();
    expect(pieceIndex([few]).label).toBe("Base insuficiente");

    expect(pieceIndex([]).value).toBeNull();
  });

  it("formatIndex usa coma decimal y el simbolo de veces", () => {
    expect(formatIndex(1.8)).toBe("1,8×");
    expect(formatIndex(0.75)).toBe("0,8×");
    expect(formatIndex(null)).toBe("—");
  });
});
