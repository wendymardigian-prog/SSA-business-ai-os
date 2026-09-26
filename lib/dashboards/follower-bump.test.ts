/**
 * El salto de seguidores alrededor de una publicacion (F52).
 *
 * Es una SEÑAL, no una atribucion: las pruebas cuidan que el modulo no
 * afirme mas de lo que puede saber.
 */

import { describe, it, expect } from "vitest";
import {
  bumpBadge,
  computeFollowerBump,
  dailyNet,
  median,
  neighborPosts,
  type FollowerPoint,
} from "./follower-bump";

/** Una serie de seguidores que sube `daily` por dia desde `start`. */
function series(start: string, values: number[]): FollowerPoint[] {
  return values.map((followers, index) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + index);
    return { date: d.toISOString().slice(0, 10), followers };
  });
}

/** Una cuenta que gana 5 por dia durante 40 dias desde el 2026-09-01. */
const steady = series(
  "2026-09-01",
  Array.from({ length: 45 }, (_, i) => 1000 + i * 5),
);

describe("el neto de cada dia (F52)", () => {
  it("es la diferencia con el dia anterior", () => {
    const net = dailyNet([
      { date: "2026-10-01", followers: 1000 },
      { date: "2026-10-02", followers: 1012 },
    ]);

    expect(net.get("2026-10-02")).toBe(12);
  });

  it("con un dia faltante en el medio, no se le atribuye a uno solo", () => {
    // La diferencia serian dos dias juntos.
    const net = dailyNet([
      { date: "2026-10-01", followers: 1000 },
      { date: "2026-10-03", followers: 1030 },
    ]);

    expect(net.has("2026-10-03")).toBe(false);
  });
});

describe("la mediana (F52)", () => {
  it("se usa en vez del promedio", () => {
    // Un dia con un post viral arrastraria el promedio.
    expect(median([2, 3, 4, 5, 200])).toBe(4);
  });

  it("sin datos no hay mediana", () => {
    expect(median([])).toBeNull();
  });
});

describe("el salto (F52)", () => {
  const today = "2026-10-20";

  it("un post normal queda dentro de lo normal", () => {
    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-10",
      points: steady,
      today,
    });

    expect(bump.verdict).toBe("normal");
    expect(bump.gained).toBe(10);
    expect(bump.expected).toBe(10);
    expect(bump.ratio).toBe(1);
  });

  it("un post que mueve la aguja se marca como salto", () => {
    const points = [
      ...steady.slice(0, 40),
      { date: "2026-10-11", followers: 1000 + 39 * 5 + 30 },
      { date: "2026-10-12", followers: 1000 + 39 * 5 + 55 },
    ];

    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-11",
      points,
      today,
    });

    expect(bump.verdict).toBe("jump");
    expect(bump.ratio).toBeGreaterThanOrEqual(1.5);
    expect(bump.label).toContain("Salto");
  });

  it("si el dia siguiente no termino, queda parcial y sin ratio", () => {
    // Dar el ratio ahora lo dejaria bajo por la mitad de un dia.
    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-15",
      points: steady,
      today: "2026-10-16",
    });

    expect(bump.verdict).toBe("partial");
    expect(bump.ratio).toBeNull();
    expect(bump.label).toContain("parcial");
  });

  it("en una cuenta chica se muestra el +N sin ratio", () => {
    // Ganando uno por dia, cualquier post "multiplica por tres".
    const small = series(
      "2026-09-01",
      Array.from({ length: 45 }, (_, i) => 100 + i),
    );

    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-10",
      points: small,
      today,
    });

    expect(bump.verdict).toBe("insufficient");
    expect(bump.ratio).toBeNull();
    expect(bump.label).toContain("todavia es chica");
  });

  it("si falta el dato de uno de los dos dias, no hay ratio", () => {
    const withGap = steady.filter((p) => p.date !== "2026-10-10");

    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-10",
      points: withGap,
      today,
    });

    expect(bump.ratio).toBeNull();
    expect(bump.verdict).toBe("insufficient");
  });

  it("LinkedIn no aplica y lo dice", () => {
    const bump = computeFollowerBump({
      platform: "linkedin",
      publishedDate: "2026-10-10",
      points: steady,
      today,
    });

    expect(bump.verdict).toBe("not_applicable");
  });

  it("la ventana es de 15 dias con los dos resaltados", () => {
    const bump = computeFollowerBump({
      platform: "instagram",
      publishedDate: "2026-10-10",
      points: steady,
      today,
    });

    expect(bump.window).toHaveLength(15);
    expect(bump.window.filter((d) => d.highlighted).map((d) => d.date)).toEqual([
      "2026-10-10",
      "2026-10-11",
    ]);
  });
});

describe("los posts vecinos (F52)", () => {
  const posts = [
    { socialPostId: "sp-1", platform: "instagram", publishedAt: "2026-10-10T10:00:00Z" },
    { socialPostId: "sp-2", platform: "instagram", publishedAt: "2026-10-11T18:00:00Z" },
    { socialPostId: "sp-3", platform: "threads", publishedAt: "2026-10-10T12:00:00Z" },
    { socialPostId: "sp-4", platform: "instagram", publishedAt: "2026-10-14T10:00:00Z" },
  ];

  it("los de la misma red en esas 48 h, sin contarse a si mismo", () => {
    // Si hubo tres, el salto es de los tres y de ninguno en particular.
    const neighbors = neighborPosts(posts, {
      socialPostId: "sp-1",
      platform: "instagram",
      publishedDate: "2026-10-10",
    });

    expect(neighbors.map((p) => p.socialPostId)).toEqual(["sp-2"]);
  });

  it("los de otra red no cuentan: cada cuenta tiene sus seguidores", () => {
    const neighbors = neighborPosts(posts, {
      socialPostId: "sp-3",
      platform: "threads",
      publishedDate: "2026-10-10",
    });

    expect(neighbors).toEqual([]);
  });
});

describe("la insignia de la tabla (F52)", () => {
  it("muestra el +N y el ratio con coma", () => {
    const badge = bumpBadge({
      gained: 40,
      expected: 22,
      ratio: 1.82,
      verdict: "jump",
      label: "",
      window: [],
      median: 11,
    });

    expect(badge).toEqual({ value: "+40", ratio: "1,8×", good: true });
  });

  it("sin dato muestra una raya, no un cero", () => {
    const badge = bumpBadge({
      gained: null,
      expected: null,
      ratio: null,
      verdict: "insufficient",
      label: "",
      window: [],
      median: null,
    });

    expect(badge.value).toBe("—");
    expect(badge.ratio).toBeNull();
  });
});
