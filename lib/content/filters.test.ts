import { describe, it, expect } from "vitest";
import {
  activeFilterCount,
  applyContentFilters,
  contentFiltersToQuery,
  matchesPlatform,
  parseContentFilters,
  toggleResponsible,
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

// ── Tirón 2, A2 · «Pautadas / No pautadas» ─────────────────────────────────

describe("A2 · filtro de piezas pautadas (?pautada=)", () => {
  const base = parseContentFilters(new URLSearchParams());
  const mk = (id: string, paid: boolean | undefined) => ({ id, title: `Pieza ${id}`, status: "draft" as const, createdBy: "u1", platforms: ["instagram"], paid });
  const rows = [mk("a", true), mk("b", false), mk("c", undefined), mk("d", true)];

  it("sin el parametro no existe el filtro y no se saca nada", () => {
    expect("paid" in base && base.paid !== undefined).toBe(false);
    expect(applyContentFilters(rows, base)).toHaveLength(4);
  });
  it("pautada=si deja solo las que tienen un anuncio vinculado", () => {
    const filters = parseContentFilters(new URLSearchParams("pautada=si"));
    expect(filters.paid).toBe("si");
    expect(applyContentFilters(rows, filters).map((p) => p.id)).toEqual(["a", "d"]);
  });
  it("pautada=no deja las que no (las que no traen el dato cuentan como no pautadas)", () => {
    const filters = parseContentFilters(new URLSearchParams("pautada=no"));
    expect(applyContentFilters(rows, filters).map((p) => p.id)).toEqual(["b", "c"]);
  });
  it("un valor inventado se ignora y no vacia la lista", () => {
    const filters = parseContentFilters(new URLSearchParams("pautada=quizas"));
    expect(filters.paid).toBeUndefined();
    expect(applyContentFilters(rows, filters)).toHaveLength(4);
  });
  it("ida y vuelta por la URL y cuenta como un filtro puesto", () => {
    const filters = parseContentFilters(new URLSearchParams("vista=list&pautada=si"));
    expect(contentFiltersToQuery(filters)).toBe("vista=list&pautada=si");
    expect(parseContentFilters(new URLSearchParams(contentFiltersToQuery(filters)))).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(1);
    expect(activeFilterCount(base)).toBe(0);
  });
  it("combina con los demas filtros", () => {
    const filters = parseContentFilters(new URLSearchParams("pautada=si&q=pieza a"));
    expect(applyContentFilters(rows, filters).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("filtro de Responsable (F43)", () => {
  const owned: FilterablePost[] = [
    { id: "a", title: "A", status: "draft", createdBy: "u1", assignedTo: "u2", platforms: [] },
    { id: "b", title: "B", status: "draft", createdBy: "u2", assignedTo: "u1", platforms: [] },
    { id: "c", title: "C", status: "draft", createdBy: "u1", assignedTo: null, platforms: [] },
    { id: "d", title: "Una idea", status: "draft", createdBy: "u1", platforms: [] },
  ];
  const ids = (list: FilterablePost[]) => list.map((p) => p.id);

  it("se lee de la URL: separado por comas o repetido, sin repetidos ni vacios", () => {
    expect(parseContentFilters(new URLSearchParams("responsable=u1,u2")).responsible).toEqual(["u1", "u2"]);
    expect(parseContentFilters(new URLSearchParams("responsable=u1&responsable=u2&responsable=u1")).responsible).toEqual(["u1", "u2"]);
    expect(parseContentFilters({ responsable: ["u1", "u3,u4"] }).responsible).toEqual(["u1", "u3", "u4"]);
    expect(parseContentFilters({ responsable: " , " }).responsible).toBeUndefined();
  });

  it("sin el parametro el resultado es el de siempre (no aparece la clave)", () => {
    expect("responsible" in parseContentFilters(new URLSearchParams("autor=u1"))).toBe(false);
  });

  it("vuelve a la URL y hace ida y vuelta", () => {
    const filters = parseContentFilters(new URLSearchParams("responsable=u1,none&estado=draft"));
    expect(contentFiltersToQuery(filters)).toBe("estado=draft&responsable=u1%2Cnone");
    expect(parseContentFilters(new URLSearchParams(contentFiltersToQuery(filters))).responsible).toEqual(["u1", "none"]);
  });

  it("filtra por responsable (assigned_to) y no por autor", () => {
    const f = parseContentFilters(new URLSearchParams("responsable=u1"));
    expect(ids(applyContentFilters(owned, f))).toEqual(["b"]);
  });

  it("varios responsables suman", () => {
    const f = parseContentFilters(new URLSearchParams("responsable=u1,u2"));
    expect(ids(applyContentFilters(owned, f))).toEqual(["a", "b"]);
  });

  it("'none' trae las piezas sin responsable (y las ideas, que no tienen)", () => {
    const f = parseContentFilters(new URLSearchParams("responsable=none"));
    expect(ids(applyContentFilters(owned, f))).toEqual(["c", "d"]);
  });

  it("el filtro de autor sigue filtrando por quien la creo", () => {
    const f = parseContentFilters(new URLSearchParams("autor=u1"));
    expect(ids(applyContentFilters(owned, f))).toEqual(["a", "c", "d"]);
    const both = parseContentFilters(new URLSearchParams("autor=u1&responsable=u2"));
    expect(ids(applyContentFilters(owned, both))).toEqual(["a"]);
  });

  it("cuenta como un filtro puesto", () => {
    expect(activeFilterCount(parseContentFilters(new URLSearchParams("responsable=u1,u2")))).toBe(1);
    expect(activeFilterCount(parseContentFilters(new URLSearchParams()))).toBe(0);
  });

  it("toggleResponsible suma y saca", () => {
    expect(toggleResponsible(undefined, "u1")).toEqual(["u1"]);
    expect(toggleResponsible(["u1"], "u2")).toEqual(["u1", "u2"]);
    expect(toggleResponsible(["u1", "u2"], "u1")).toEqual(["u2"]);
  });
});
