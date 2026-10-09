import { describe, expect, it } from "vitest";
import {
  CONTACT_SORTS,
  CONTACT_SORT_LABELS,
  DEFAULT_CONTACT_SORT,
  contactOrderClauses,
  parseContactSort,
} from "./sort";

describe("parseContactSort", () => {
  it("acepta cada orden de la lista", () => {
    for (const sort of CONTACT_SORTS) expect(parseContactSort(sort)).toBe(sort);
  });

  it("sin valor, o con uno inventado, vuelve al de siempre (la URL es del navegador)", () => {
    expect(parseContactSort(undefined)).toBe(DEFAULT_CONTACT_SORT);
    expect(parseContactSort(null)).toBe(DEFAULT_CONTACT_SORT);
    expect(parseContactSort("")).toBe(DEFAULT_CONTACT_SORT);
    expect(parseContactSort("password")).toBe(DEFAULT_CONTACT_SORT);
    expect(parseContactSort("created_at; drop table contacts")).toBe(DEFAULT_CONTACT_SORT);
  });

  it("si la URL repite el parametro, vale el primero", () => {
    expect(parseContactSort(["nombre", "nuevos"])).toBe("nombre");
  });

  it("el de siempre es la ultima interaccion", () => {
    expect(DEFAULT_CONTACT_SORT).toBe("reciente");
  });
});

describe("contactOrderClauses", () => {
  it("el orden de siempre queda igual: ultima interaccion, sin interaccion al final, y desempate por creacion", () => {
    expect(contactOrderClauses("reciente").slice(0, 2)).toEqual([
      { column: "last_interaction_at", ascending: false, nullsFirst: false },
      { column: "created_at", ascending: false },
    ]);
  });

  it("todos terminan en `id`: sin un desempate unico la paginacion repite o se saltea filas", () => {
    for (const sort of CONTACT_SORTS) {
      const clauses = contactOrderClauses(sort);
      expect(clauses[clauses.length - 1]).toEqual({ column: "id", ascending: true });
    }
  });

  it("por nombre, los que no tienen nombre van al final", () => {
    expect(contactOrderClauses("nombre")[0]).toEqual({ column: "display_name", ascending: true, nullsFirst: false });
  });

  it("nuevos y antiguos son opuestos sobre la fecha de creacion", () => {
    expect(contactOrderClauses("nuevos")[0]).toEqual({ column: "created_at", ascending: false });
    expect(contactOrderClauses("antiguos")[0]).toEqual({ column: "created_at", ascending: true });
  });

  it("todos tienen etiqueta en castellano", () => {
    for (const sort of CONTACT_SORTS) expect(CONTACT_SORT_LABELS[sort].length).toBeGreaterThan(0);
  });
});
