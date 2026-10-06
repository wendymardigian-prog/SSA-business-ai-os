import { describe, it, expect } from "vitest";
import {
  activeFilterCount,
  applyContentFilters,
  contentFiltersToQuery,
  matchesPlatform,
  parseContentFilters,
  type FilterablePost,
} from "./filters";

const posts: FilterablePost[] = [
  { id: "a", title: "Como cobrar sin miedo", status: "draft", createdBy: "u1", platforms: ["instagram"] },
  { id: "b", title: "Tres errores al vender", status: "published", createdBy: "u2", platforms: ["youtube", "instagram"] },
  { id: "c", title: "Mi proceso", status: "in_review", createdBy: "u1", platforms: [] },
];

describe("filtros en la URL (F21)", () => {
  it("sin nada en la URL, el tablero y contando piezas", () => {
    expect(parseContentFilters(new URLSearchParams())).toEqual({
      view: "kanban",
      platform: null,
      status: null,
      author: null,
      month: null,
      count: "pieces",
      q: null,
    });
  });

  it("lee lo que entiende", () => {
    const filters = parseContentFilters(
      new URLSearchParams("vista=calendar&red=youtube&estado=draft&mes=2026-10&contar=publications"),
    );

    expect(filters).toMatchObject({
      view: "calendar",
      platform: "youtube",
      status: "draft",
      month: "2026-10",
      count: "publications",
    });
  });

  it("un valor inventado no vacia la lista: se ignora", () => {
    const filters = parseContentFilters(new URLSearchParams("vista=galaxia&estado=inventado&mes=octubre"));

    expect(filters.view).toBe("kanban");
    expect(filters.status).toBeNull();
    expect(filters.month).toBeNull();
  });

  it("ida y vuelta: lo que se arma se vuelve a leer igual", () => {
    const original = parseContentFilters(
      new URLSearchParams("vista=list&red=instagram&autor=u1&q=cobrar"),
    );

    expect(parseContentFilters(new URLSearchParams(contentFiltersToQuery(original)))).toEqual(original);
  });

  it("los valores por defecto no ensucian la URL", () => {
    expect(contentFiltersToQuery(parseContentFilters(new URLSearchParams()))).toBe("");
  });
});

describe("aplicar los filtros", () => {
  const base = parseContentFilters(new URLSearchParams());

  it("sin filtros no se saca nada", () => {
    expect(applyContentFilters(posts, base)).toHaveLength(3);
  });

  it("por red, por estado y por autor", () => {
    expect(applyContentFilters(posts, { ...base, platform: "youtube" }).map((p) => p.id)).toEqual(["b"]);
    expect(applyContentFilters(posts, { ...base, status: "draft" }).map((p) => p.id)).toEqual(["a"]);
    expect(applyContentFilters(posts, { ...base, author: "u1" }).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("la busqueda no distingue mayusculas", () => {
    expect(applyContentFilters(posts, { ...base, q: "COBRAR" }).map((p) => p.id)).toEqual(["a"]);
  });

  it("los filtros se suman", () => {
    expect(
      applyContentFilters(posts, { ...base, platform: "instagram", author: "u1" }).map((p) => p.id),
    ).toEqual(["a"]);
  });

  it("una pieza sin redes queda fuera al filtrar por red", () => {
    expect(applyContentFilters(posts, { ...base, platform: "instagram" }).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("cuenta cuantos filtros hay puestos", () => {
    expect(activeFilterCount(base)).toBe(0);
    expect(activeFilterCount({ ...base, platform: "x", q: "y" })).toBe(2);
    // El mes y el modo de conteo no son filtros: son como se mira.
    expect(activeFilterCount({ ...base, month: "2026-10", count: "publications" })).toBe(0);
  });
});

// ── C15 · el filtro de mes en la lista ────────────────────────────────────

describe("C15 · filtrar por mes", () => {
  const base = parseContentFilters(new URLSearchParams());
  const post = (id: string, firstAt: string | null) => ({
    id,
    title: `Pieza ${id}`,
    status: "draft" as const,
    createdBy: "u1",
    platforms: ["instagram"],
    firstAt,
  });

  const posts = [
    post("a", "2026-10-06T18:00:00.000Z"),
    post("b", "2026-11-02T18:00:00.000Z"),
    post("c", null),
  ];

  it("deja solo las de ese mes", () => {
    const result = applyContentFilters(posts, { ...base, month: "2026-10" });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("sin mes, estan todas", () => {
    expect(applyContentFilters(posts, base)).toHaveLength(3);
  });

  it("una sin fecha no pertenece a ningun mes", () => {
    const result = applyContentFilters(posts, { ...base, month: "2026-11" });
    expect(result.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("el filtro de Red de la barra superior (F98)", () => {
  it("sin red elegida entra todo", () => {
    expect(matchesPlatform(["instagram"], null)).toBe(true);
    expect(matchesPlatform([], null)).toBe(true);
  });

  it("con una red elegida, entra lo que apunta a ella", () => {
    expect(matchesPlatform(["instagram", "tiktok"], "tiktok")).toBe(true);
    expect(matchesPlatform(["instagram"], "tiktok")).toBe(false);
  });

  it("algo sin redes no entra cuando se filtra por una", () => {
    expect(matchesPlatform([], "instagram")).toBe(false);
  });
});
