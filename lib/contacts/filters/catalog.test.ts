import { describe, expect, it } from "vitest";
import { CONTACT_FILTERS } from "../list-modules";
import { filterChipText, filterOptionList, filterPanelGroups } from "./catalog";

const byParam = (p: string) => {
  const def = CONTACT_FILTERS.find((f) => f.param === p);
  if (!def) throw new Error(p);
  return def;
};
const options = {
  members: [
    { value: "u1", label: "Ana" },
    { value: "u2", label: "Juan" },
    { value: "u3", label: "Lía" },
  ],
};

describe("el catálogo de filtros", () => {
  it("cada parámetro de la URL es de un solo filtro", () => {
    const params = CONTACT_FILTERS.map((f) => f.param);
    expect(new Set(params).size).toBe(params.length);
  });

  it("no pisa los parámetros de la pantalla", () => {
    for (const reserved of ["q", "page", "orden", "vista", "agrupar", "campo", "op", "valor"]) {
      expect(CONTACT_FILTERS.map((f) => f.param)).not.toContain(reserved);
    }
  });

  it("los filtros de una sola opción declaran sus opciones o su tipo", () => {
    for (const f of CONTACT_FILTERS) {
      if (f.kind === "multi" || f.kind === "choice") expect(f.options, f.param).toBeDefined();
      if (f.kind === "date") expect(f.datePresets?.length ?? 0, f.param).toBeGreaterThan(0);
    }
  });
});

describe("el buscador del panel", () => {
  it("sin buscar, todos los grupos en orden", () => {
    const groups = filterPanelGroups(CONTACT_FILTERS, "");
    const orders = groups.map((g) => g.group.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(groups.flatMap((g) => g.filters).length).toBe(CONTACT_FILTERS.length);
  });

  it("encuentra por nombre, por grupo y por palabra extra, sin tildes", () => {
    expect(filterPanelGroups(CONTACT_FILTERS, "temperatura").flatMap((g) => g.filters.map((f) => f.param))).toEqual(["temp"]);
    expect(filterPanelGroups(CONTACT_FILTERS, "asignacion").flatMap((g) => g.filters.map((f) => f.param))).toEqual(["setter", "vendedor"]);
    expect(filterPanelGroups(CONTACT_FILTERS, "closer").flatMap((g) => g.filters.map((f) => f.param))).toContain("vendedor");
    expect(filterPanelGroups(CONTACT_FILTERS, "nada-que-ver")).toEqual([]);
  });
});

describe("opciones y chips", () => {
  it("«ninguno» va arriba cuando el filtro lo ofrece", () => {
    expect(filterOptionList(byParam("setter"), options).map((o) => o.value)).toEqual(["ninguno", "u1", "u2", "u3"]);
    expect(filterOptionList(byParam("tag"), {})).toEqual([]);
  });

  it("el chip nombra el filtro y lo elegido; con más de dos, cuántos", () => {
    expect(filterChipText(byParam("setter"), ["u1", "ninguno"], options)).toBe("Setter: Ana, Sin asignar");
    expect(filterChipText(byParam("setter"), ["u1", "u2", "u3"], options)).toBe("Setter: 3 elegidos");
    expect(filterChipText(byParam("temp"), ["hot"], {})).toMatch(/^Temperatura: /);
    expect(filterChipText(byParam("anon"), ["solo"], {})).toBe("Contactos sin datos: Solo esos");
  });

  it("un valor que ya no está entre las opciones se muestra tal cual (para poder quitarlo)", () => {
    expect(filterChipText(byParam("setter"), ["u9"], options)).toBe("Setter: u9");
  });
});
