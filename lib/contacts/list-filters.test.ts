import { describe, expect, it } from "vitest";
import { customFilterPlan, parseCustomFilter, parsePipelineFilters, parseVisibleColumns, pipelineClauses } from "./list-filters";

const fields = [
  { id: "f-viajeros", slug: "cantidad_de_viajeros", name: "Cantidad de viajeros", type: "number" },
  { id: "f-salida", slug: "salida", name: "Salida", type: "date" },
  { id: "f-vip", slug: "vip", name: "VIP", type: "boolean" },
  { id: "f-destino", slug: "destino", name: "Destino", type: "text" },
];

describe("estado y producto en la URL", () => {
  it("lee los filtros e ignora lo inventado", () => {
    const f = parsePipelineFilters({ estado: "closer:ganado", estado_setter: "ninguno", estado_vendedor: "MAL VALOR", producto: "no-es-uuid" });
    expect(f.lastStatus).toEqual({ role: "closer", key: "ganado" });
    expect(f.setterStatus).toBe("ninguno");
    expect(f.closerStatus).toBe("");
    expect(f.productId).toBe("");
  });

  it("arma las condiciones", () => {
    const f = parsePipelineFilters({ estado: "setter:calificado", estado_setter: "ninguno", producto: "9f0d1b6e-1111-2222-3333-444455556666" });
    expect(pipelineClauses(f)).toEqual([
      { column: "last_status_role", op: "eq", value: "setter" },
      { column: "last_status", op: "eq", value: "calificado" },
      { column: "setter_status", op: "is_null" },
      { column: "interest_product_id", op: "eq", value: "9f0d1b6e-1111-2222-3333-444455556666" },
    ]);
  });
});

describe("filtro por campo personalizado", () => {
  it("«más de 3 viajeros» compara como número", () => {
    const f = parseCustomFilter({ campo: "cantidad_de_viajeros", op: "gt", valor: "3" }, fields);
    expect(f && customFilterPlan(f)).toEqual({ join: "inner", fieldId: "f-viajeros", column: "value_number", op: "gt", value: 3 });
  });

  it("una fecha compara como fecha", () => {
    const f = parseCustomFilter({ campo: "salida", op: "after", valor: "01/12/2026" }, fields);
    expect(f && customFilterPlan(f)).toEqual({ join: "inner", fieldId: "f-salida", column: "value_date", op: "gt", value: "2026-12-01" });
  });

  it("sí/no se normaliza", () => {
    const f = parseCustomFilter({ campo: "vip", op: "eq", valor: "Sí" }, fields);
    expect(f && customFilterPlan(f)).toEqual({ join: "inner", fieldId: "f-vip", column: "value", op: "eq", value: "true" });
  });

  it("texto: contiene, con los comodines escapados", () => {
    const f = parseCustomFilter({ campo: "destino", op: "contains", valor: "50%" }, fields);
    expect(f && customFilterPlan(f)).toEqual({ join: "inner", fieldId: "f-destino", column: "value", op: "ilike", value: "%50\\%%" });
  });

  it("vacío y con valor no piden valor", () => {
    expect(customFilterPlan(parseCustomFilter({ campo: "destino", op: "empty" }, fields)!)).toEqual({ join: "anti", fieldId: "f-destino" });
    expect(customFilterPlan(parseCustomFilter({ campo: "destino", op: "filled" }, fields)!)).toMatchObject({ join: "inner", op: "not_null" });
  });

  it("descarta lo que no sirve", () => {
    expect(parseCustomFilter({ campo: "no_existe", op: "eq", valor: "x" }, fields)).toBeNull();
    expect(parseCustomFilter({ campo: "cantidad_de_viajeros", op: "contains", valor: "3" }, fields)).toBeNull();
    expect(parseCustomFilter({ campo: "cantidad_de_viajeros", op: "gt", valor: "muchos" }, fields)).toBeNull();
    expect(parseCustomFilter({ campo: "destino", op: "eq", valor: "  " }, fields)).toBeNull();
  });
});

describe("las columnas elegidas", () => {
  it("sin nada guardado, Estado y Producto", () => {
    expect(parseVisibleColumns(null, [])).toEqual(["status", "product"]);
    expect(parseVisibleColumns("{roto", [])).toEqual(["status", "product"]);
  });
  it("descarta un campo que ya no existe", () => {
    expect(parseVisibleColumns(JSON.stringify(["status", "cf:f-viajeros", "cf:borrado"]), ["f-viajeros"])).toEqual(["status", "cf:f-viajeros"]);
  });
  it("una lista vacía a propósito se respeta", () => {
    expect(parseVisibleColumns("[]", [])).toEqual([]);
  });
});
