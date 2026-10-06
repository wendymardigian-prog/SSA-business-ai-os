/**
 * F88: el filtro de la lista de contactos por primer toque.
 *
 * Lo que se fija: que un valor inventado en la URL se ignore, que las
 * condiciones apunten al PRIMER toque (no al último) y que coincidan con los
 * índices de la 00114.
 */
import { describe, it, expect } from "vitest";
import {
  FIRST_TOUCH_MEDIUM_PATH,
  FIRST_TOUCH_SOURCE_PATH,
  attributionClauses,
  hasAttributionFilter,
  parseAttributionFilters,
} from "./attribution-filter";

describe("parseAttributionFilters (F88)", () => {
  it("lee la fuente y el medio de la URL", () => {
    expect(parseAttributionFilters({ fuente: "instagram", medio: "comment" })).toEqual({
      source: "instagram", medium: "comment",
    });
  });

  it("sin parámetros no filtra nada", () => {
    expect(parseAttributionFilters({})).toEqual({ source: "", medium: "" });
    expect(hasAttributionFilter(parseAttributionFilters({}))).toBe(false);
  });

  it("un valor inventado se ignora en vez de romper la consulta", () => {
    expect(parseAttributionFilters({ fuente: "'; drop table contacts; --", medio: "telepatia" })).toEqual({
      source: "", medium: "",
    });
  });

  it("un valor que no es de la lista cerrada se ignora, aunque sea una fuente real cruda", () => {
    expect(parseAttributionFilters({ fuente: "facebook" }).source).toBe("");
  });

  it("si el parámetro viene repetido, toma el primero", () => {
    expect(parseAttributionFilters({ fuente: ["tiktok", "instagram"] }).source).toBe("tiktok");
  });

  it("solo la fuente, o solo el medio", () => {
    expect(parseAttributionFilters({ fuente: "whatsapp" })).toEqual({ source: "whatsapp", medium: "" });
    expect(parseAttributionFilters({ medio: "dm" })).toEqual({ source: "", medium: "dm" });
  });
});

describe("attributionClauses (F88)", () => {
  it("filtra por el PRIMER toque, no por el último", () => {
    const clauses = attributionClauses({ source: "instagram", medium: "comment" });

    expect(clauses).toEqual([
      { path: "attribution->first_touch->>source", value: "instagram" },
      { path: "attribution->first_touch->>medium", value: "comment" },
    ]);
    expect(JSON.stringify(clauses)).not.toContain("last_touch");
  });

  it("las rutas son las mismas de los índices de la 00114", () => {
    expect(FIRST_TOUCH_SOURCE_PATH).toBe("attribution->first_touch->>source");
    expect(FIRST_TOUCH_MEDIUM_PATH).toBe("attribution->first_touch->>medium");
  });

  it("sin filtros no hay condiciones", () => {
    expect(attributionClauses({ source: "", medium: "" })).toEqual([]);
  });

  it("solo el medio da una sola condición", () => {
    expect(attributionClauses({ source: "", medium: "dm" })).toHaveLength(1);
  });
});
