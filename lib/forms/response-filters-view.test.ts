import { describe, expect, it } from "vitest";
import { clearMenuFilters, countMenuFilters, dimensionParam, filterChips, selectGroup } from "./response-filters-view";
import { NO_VALUE, RESPONSE_DIMENSIONS } from "./response-index";

const DIMS = RESPONSE_DIMENSIONS;

describe("los filtros puestos", () => {
  it("cuenta estado, contacto y cada dimension con algo elegido", () => {
    expect(countMenuFilters({ status: "all", contact: "all", dims: {} }, DIMS)).toBe(0);
    expect(countMenuFilters({ status: "spam", contact: "with", dims: { pais: ["PE"], fuente: [] } }, DIMS)).toBe(3);
  });

  it("un pais que el formulario no tiene (sin telefono) no cuenta", () => {
    expect(countMenuFilters({ status: "all", contact: "all", dims: { pais: ["PE"] } }, ["fuente"])).toBe(0);
  });

  it("los chips dicen lo elegido y como sacarlo", () => {
    const chips = filterChips({ status: "all", contact: "without", dims: { pais: ["PE", NO_VALUE], medio: ["a", "b", "c"] } }, DIMS);
    expect(chips.map((c) => c.label)).toEqual(["Sin contacto", "País: 🇵🇪 Perú, Sin país", "Medio: 3 elegidos"]);
    expect(chips[1].clear).toEqual({ pais: null });
  });
});

describe("la URL", () => {
  it("varios valores separados por coma; ninguno saca el filtro", () => {
    expect(dimensionParam(["PE", "AR"])).toBe("PE,AR");
    expect(dimensionParam([])).toBeNull();
  });

  it("limpiar saca los filtros del menu y no la busqueda ni la fecha", () => {
    const clear = clearMenuFilters(DIMS);
    expect(clear).toMatchObject({ estado: null, contacto: null, pais: null, contenido: null });
    expect("q" in clear || "range" in clear || "agrupar" in clear).toBe(false);
  });

  it("tocar un grupo filtra por el y vuelve a la lista", () => {
    expect(selectGroup("campana", "clase")).toEqual({ campana: "clase", agrupar: null });
  });
});
