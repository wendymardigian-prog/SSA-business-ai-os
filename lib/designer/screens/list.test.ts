import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  cardView,
  DEFAULT_LIST_FILTERS,
  emptyState,
  formatFilterOptions,
  isOwnDesign,
  LIST_PAGE_SIZE,
  listFiltersToQuery,
  originValues,
  pageCount,
  pageRange,
  parseListFilters,
  whenLabel,
  withFilter,
  type CardRow,
  type ListFilters,
} from "./list";

describe("filtros de la lista ↔ URL (F15)", () => {
  const sets: ListFilters[] = [
    DEFAULT_LIST_FILTERS,
    { ...DEFAULT_LIST_FILTERS, tab: "plantillas" },
    { ...DEFAULT_LIST_FILTERS, q: "carrusel", format: "v45", origin: "ai" },
    { tab: "plantillas", q: "constancia ñandú", format: "carta_h", origin: "manual", archived: true, page: 3 },
    { ...DEFAULT_LIST_FILTERS, origin: "html", archived: true, page: 2 },
  ];

  it("ida y vuelta: lo que se escribe se vuelve a leer igual", () => {
    for (const filters of sets) {
      const qs = listFiltersToQuery(filters);
      expect(parseListFilters(new URLSearchParams(qs)), qs).toEqual(filters);
    }
  });

  it("sin filtros la URL queda limpia", () => {
    expect(listFiltersToQuery(DEFAULT_LIST_FILTERS)).toBe("");
  });

  it("lo que no existe vuelve al valor de siempre (nunca rompe)", () => {
    expect(parseListFilters({ tab: "otra", formato: "xx", origen: "raro", pagina: "-4", q: "  hola  " })).toEqual({ ...DEFAULT_LIST_FILTERS, q: "hola" });
    expect(parseListFilters({ pagina: "abc" }).page).toBe(1);
    expect(parseListFilters({ formato: ["v45", "sq"] }).format).toBe("v45");
  });

  it("cambiar un filtro vuelve a la página 1", () => {
    expect(withFilter({ ...DEFAULT_LIST_FILTERS, page: 4 }, { q: "x" }).page).toBe(1);
  });

  it("cuenta los filtros puestos (la pestaña y la página no cuentan)", () => {
    expect(activeFilterCount(DEFAULT_LIST_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_LIST_FILTERS, tab: "plantillas", page: 2 })).toBe(0);
    expect(activeFilterCount(sets[3])).toBe(4);
  });

  it("los orígenes del filtro corresponden a los de la base", () => {
    expect(originValues("all")).toEqual([]);
    expect(originValues("ai")).toEqual(["ai"]);
    expect(originValues("manual").sort()).toEqual(["blank", "image"]);
    expect(originValues("html")).toEqual(["html"]);
  });

  it("las plantillas no ofrecen el formato de página web", () => {
    expect(formatFilterOptions("plantillas")).not.toContain("web");
    expect(formatFilterOptions("disenos")).toContain("web");
  });
});

describe("una generación nunca aparece en la lista de Diseños (F15)", () => {
  it("solo es propio el que no tiene plantilla", () => {
    expect(isOwnDesign({ template_id: null })).toBe(true);
    expect(isOwnDesign({ template_id: "6f1c2b3a-0000-0000-0000-000000000000" })).toBe(false);
  });
});

describe("la tarjeta (F15, §11.2)", () => {
  const now = new Date("2026-11-07T15:00:00Z");
  const opts = { now, timeZone: "UTC" };
  const design: CardRow = { id: "d1", kind: "design", name: "Carrusel de prueba", format: "v45", origin: "ai", pages: 7, updatedAt: "2026-11-07T09:12:00Z", archived: false, published: true };

  it("un diseño: estado, origen, páginas, formato y fecha", () => {
    const view = cardView(design, opts);
    expect(view.href).toBe("/dashboard/disenos/d/d1");
    expect(view.badges.map((b) => b.label)).toEqual(["Publicado", "Hecho con IA"]);
    expect(view.pagesLabel).toBe("7 páginas");
    expect(view.metaLine).toBe("Vertical 4:5 · imagen · hoy 09:12");
  });

  it("una sola página no lleva sello de páginas y un borrador lo dice", () => {
    const view = cardView({ ...design, pages: 1, published: false, origin: "blank" }, opts);
    expect(view.pagesLabel).toBeNull();
    expect(view.badges.map((b) => b.label)).toEqual(["Borrador", "Hecho a mano"]);
  });

  it("una página web se comparte con link", () => {
    expect(cardView({ ...design, format: "web", pages: 1 }, opts).metaLine).toContain("Se comparte con link");
  });

  it("una plantilla: variables, generados, 'Desde una imagen' y verificación con su tipo", () => {
    const view = cardView(
      { id: "t1", kind: "template", name: "Certificado", format: "carta_h", origin: "image", pages: 1, updatedAt: "2026-11-06T10:00:00Z", archived: false, variables: 4, generated: 23, verify: true, docType: "constancia" },
      opts,
    );
    expect(view.href).toBe("/dashboard/disenos/t/t1");
    expect(view.badges.map((b) => b.label)).toEqual(["Plantilla", "4 variables", "Se verifica · Constancia", "Desde una imagen", "23 generados"]);
    expect(view.metaLine).toBe("Carta horizontal · Exporta PDF · ayer 10:00");
  });

  it("singular en una variable y un generado; 'Otro' muestra el nombre que escribió el negocio", () => {
    const view = cardView(
      { id: "t2", kind: "template", name: "Credencial", format: "a4_v", origin: "ai", pages: 1, updatedAt: "2026-01-02T10:00:00Z", archived: true, variables: 1, generated: 1, verify: true, docType: "otro", docTypeLabel: "Credencial" },
      opts,
    );
    expect(view.badges.map((b) => b.label)).toEqual(["Plantilla", "1 variable", "Se verifica · Credencial", "1 generado", "Archivado"]);
  });

  it("la fecha usa la zona de quien mira", () => {
    expect(whenLabel("2026-11-07T01:30:00Z", now, "America/Costa_Rica")).toBe("ayer 19:30");
    expect(whenLabel("2025-03-12T12:00:00Z", now, "UTC")).toBe("12 mar 2025");
  });
});

describe("paginación de a 48 y estados vacíos", () => {
  it("rangos y cantidad de páginas", () => {
    expect(LIST_PAGE_SIZE).toBe(48);
    expect(pageRange(1)).toEqual({ from: 0, to: 47 });
    expect(pageRange(3)).toEqual({ from: 96, to: 143 });
    expect(pageCount(0)).toBe(1);
    expect(pageCount(48)).toBe(1);
    expect(pageCount(49)).toBe(2);
  });

  it("el vacío invita a crear; con filtros dice que ninguno coincide", () => {
    expect(emptyState("disenos", false).title).toBe("Todavía no hay diseños");
    expect(emptyState("disenos", false).text).toContain("Creá el primero con IA");
    expect(emptyState("plantillas", true).title).toBe("Ninguna plantilla coincide");
  });
});
