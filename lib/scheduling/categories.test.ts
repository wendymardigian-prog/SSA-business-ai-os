import { describe, expect, it } from "vitest";
import { canArchive, categoryLabel, categorySnapshot, categoryTree, expandCategoryFilter, isInArea, reorderSiblings, resolveCategory, validateCategoryName, type CategoryRow } from "./categories";

const c = (over: Partial<CategoryRow> & { id: string; name: string }): CategoryRow => ({ parent_id: null, color: null, position: 0, is_system: false, archived_at: null, ...over });
const cats: CategoryRow[] = [
  c({ id: "ventas", name: "Ventas", color: "#2563eb", is_system: true }),
  c({ id: "triaje", name: "Triaje", parent_id: "ventas", position: 0 }),
  c({ id: "cierre", name: "Cierre", parent_id: "ventas", position: 1 }),
  c({ id: "servicio", name: "Servicio", is_system: true, position: 1 }),
  c({ id: "onb", name: "Onboarding", parent_id: "servicio" }),
  c({ id: "viejo", name: "Viejo", parent_id: "ventas", position: 2, archived_at: "2026-01-01" }),
];

describe("resolveCategory (F51)", () => {
  it("un tipo devuelve su area y el tipo; un area, solo el area", () => {
    expect(resolveCategory("triaje", cats)).toMatchObject({ area: { id: "ventas" }, type: { id: "triaje" } });
    expect(resolveCategory("ventas", cats)).toMatchObject({ area: { id: "ventas" }, type: null });
    expect(resolveCategory("nada", cats)).toEqual({ area: null, type: null });
  });
  it("snapshot y etiqueta", () => {
    expect(categorySnapshot("cierre", cats)).toEqual({ area_id: "ventas", area_name: "Ventas", type_id: "cierre", type_name: "Cierre" });
    expect(categorySnapshot("servicio", cats)).toEqual({ area_id: "servicio", area_name: "Servicio", type_id: null, type_name: null });
    expect(categoryLabel("cierre", cats)).toBe("Ventas · Cierre");
    expect(categoryLabel("servicio", cats)).toBe("Servicio");
  });
  it("filtrar por el area Ventas incluye sus tipos y los que tienen solo el area", () => {
    expect(isInArea("cierre", "ventas", cats)).toBe(true);
    expect(isInArea("ventas", "ventas", cats)).toBe(true);
    expect(isInArea("onb", "ventas", cats)).toBe(false);
    expect([...expandCategoryFilter(["ventas"], cats)].sort()).toEqual(["cierre", "triaje", "ventas", "viejo"]);
  });
});

describe("nombres y archivo (F50)", () => {
  const areas = cats.filter((x) => x.parent_id === null);
  it("rechaza vacio, largo y repetido sin importar mayusculas", () => {
    expect(validateCategoryName("", areas)).toMatchObject({ ok: false, error: "empty" });
    expect(validateCategoryName("a".repeat(41), areas)).toMatchObject({ ok: false, error: "too_long" });
    expect(validateCategoryName("ventas", areas)).toMatchObject({ ok: false, error: "duplicate" });
    expect(validateCategoryName("Ventas", areas, "ventas")).toEqual({ ok: true, name: "Ventas" });
    expect(validateCategoryName("  Comunidad  ", areas)).toEqual({ ok: true, name: "Comunidad" });
  });
  it("un tipo archivado no bloquea el nombre", () => {
    expect(validateCategoryName("Viejo", cats.filter((x) => x.parent_id === "ventas"))).toEqual({ ok: true, name: "Viejo" });
  });
  it("las areas de sistema no se archivan; sus tipos si", () => {
    expect(canArchive(cats[0]).ok).toBe(false);
    expect(canArchive(cats[1]).ok).toBe(true);
  });
  it("el arbol ordena y esconde los archivados salvo que se pidan", () => {
    const tree = categoryTree(cats);
    expect(tree.map((t) => [t.area.id, t.types.map((x) => x.id)])).toEqual([["ventas", ["triaje", "cierre"]], ["servicio", ["onb"]]]);
    expect(categoryTree(cats, true)[0].types.map((x) => x.id)).toEqual(["triaje", "cierre", "viejo"]);
  });
  it("reordenar mueve y renumera", () => {
    expect(reorderSiblings(cats.filter((x) => x.parent_id === "ventas" && !x.archived_at), "cierre", 0)).toEqual([{ id: "cierre", position: 0 }, { id: "triaje", position: 1 }]);
  });
});
