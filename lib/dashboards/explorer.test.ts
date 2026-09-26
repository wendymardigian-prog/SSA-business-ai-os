/**
 * El explorador de tendencias (F49).
 */

import { describe, it, expect } from "vitest";
import {
  buildSeries,
  canMarkPosts,
  canStack,
  DEFAULT_CONFIG,
  explorerConfigToParams,
  normalizeConfig,
  parseExplorerConfig,
  platformHasMetric,
  SHORTCUTS,
  type ExplorerConfig,
} from "./explorer";

const config = (over: Partial<ExplorerConfig> = {}): ExplorerConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

describe("que se puede apilar (F49)", () => {
  it("un porcentaje no: sumarlos no significa nada", () => {
    const decision = canStack("engagement_rate");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("no significa nada");
  });

  it("los seguidores tampoco: son un total, no algo que pase cada dia", () => {
    expect(canStack("followers").allowed).toBe(false);
  });

  it("el alcance si", () => {
    expect(canStack("reach")).toEqual({ allowed: true });
  });

  it("un link que pide apilar porcentajes se dibuja lado a lado", () => {
    // Mejor que mostrar un grafico sin sentido.
    expect(normalizeConfig(config({ bars: "engagement_rate", barMode: "stacked" })).barMode).toBe("grouped");
  });
});

describe("marcar publicaciones (F49)", () => {
  it("solo agrupando por dia", () => {
    expect(canMarkPosts("day").allowed).toBe(true);
    expect(canMarkPosts("month").allowed).toBe(false);
  });

  it("agrupando por mes, se apaga solo", () => {
    expect(normalizeConfig(config({ grouping: "month", markPosts: true })).markPosts).toBe(false);
  });
});

describe("que metrica da cada red (F49)", () => {
  it("LinkedIn solo puede contar publicaciones", () => {
    expect(platformHasMetric("linkedin", "posts")).toBe(true);
    expect(platformHasMetric("linkedin", "reach")).toBe(false);
  });

  it("los guardados son de Instagram", () => {
    expect(platformHasMetric("instagram", "saves")).toBe(true);
    expect(platformHasMetric("youtube", "saves")).toBe(false);
  });

  it("el tiempo visto es de video", () => {
    expect(platformHasMetric("youtube", "watch_time")).toBe(true);
    expect(platformHasMetric("threads", "watch_time")).toBe(false);
  });
});

describe("la URL (F49)", () => {
  it("copiar el link y abrirlo reconstruye la misma vista", () => {
    const original = config({
      bars: "interactions",
      lines: "engagement_d7",
      platforms: ["instagram", "threads"],
      grouping: "week",
    });

    const params = explorerConfigToParams(original);
    const parsed = parseExplorerConfig(new URLSearchParams(params.toString()));

    expect(parsed).toEqual(normalizeConfig(original));
  });

  it("lo que es igual al default no va en la URL", () => {
    // Ocho parametros iguales a los de siempre es una URL imposible de leer.
    expect(explorerConfigToParams(config()).toString()).toBe("");
  });

  it("un parametro inventado cae al default en vez de romper", () => {
    const parsed = parseExplorerConfig(new URLSearchParams("bars=telepatia&g=decada"));

    expect(parsed.bars).toBe(DEFAULT_CONFIG.bars);
    expect(parsed.grouping).toBe("day");
  });

  it("las redes vuelven ordenadas y sin repetir", () => {
    const parsed = parseExplorerConfig(new URLSearchParams("redes=threads,instagram,threads"));

    expect(parsed.platforms).toEqual(["instagram", "threads"]);
  });
});

describe("los atajos (F49)", () => {
  it("son cuatro y cada uno arma una vista valida", () => {
    expect(SHORTCUTS).toHaveLength(4);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.config.bars).toBeTruthy();
      expect(shortcut.label.length).toBeGreaterThan(0);
    }
  });
});

describe("armar las series (F49)", () => {
  const resolve = () => [{ bucket: "2026-10-01", value: 100 }];

  it("una de barras y una de linea por red", () => {
    const series = buildSeries({
      config: config({ bars: "reach", lines: "likes" }),
      platforms: ["instagram", "threads"],
      resolve,
    });

    expect(series).toHaveLength(4);
    expect(series.filter((s) => s.kind === "bar")).toHaveLength(2);
  });

  it("una red sin esa metrica no dibuja: dice por que", () => {
    // Una linea en cero diria que LinkedIn tuvo cero de alcance.
    const series = buildSeries({
      config: config({ bars: "reach", lines: "none" }),
      platforms: ["linkedin"],
      resolve,
    });

    expect(series[0].points).toEqual([]);
    expect(series[0].unavailableReason).toContain("linkedin");
  });

  it("con 'Ninguna' en un eje, ese eje no tiene series", () => {
    const series = buildSeries({
      config: config({ bars: "none", lines: "followers" }),
      platforms: ["instagram"],
      resolve,
    });

    expect(series.every((s) => s.kind === "line")).toBe(true);
  });

  it("las redes elegidas mandan sobre las conectadas", () => {
    const series = buildSeries({
      config: config({ bars: "reach", lines: "none", platforms: ["threads"] }),
      platforms: ["instagram", "threads", "youtube"],
      resolve,
    });

    expect(series.map((s) => s.platform)).toEqual(["threads"]);
  });
});
