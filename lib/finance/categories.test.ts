import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES, activeCategories, categoryGroup, categoryName, newCategoryKey, parseCategories, validateCategoriesUpdate, type ExpenseCategory } from "./categories";

const base = () => DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));
const custom = (over: Partial<ExpenseCategory> = {}): ExpenseCategory => ({ key: "viajes", name: "Viajes", color: "#2563eb", group: "operacion", system: false, archived_at: null, ...over });

describe("categorías precargadas", () => {
  it("son 12, todas de sistema, con claves únicas y el grupo de Adquisición incluye las comisiones del equipo", () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toHaveLength(12);
    expect(new Set(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.key)).size).toBe(12);
    expect(DEFAULT_EXPENSE_CATEGORIES.every((c) => c.system && !c.archived_at)).toBe(true);
    expect(categoryGroup(DEFAULT_EXPENSE_CATEGORIES, "commissions")).toBe("adquisicion");
    expect(categoryGroup(DEFAULT_EXPENSE_CATEGORIES, "ads_meta")).toBe("adquisicion");
    expect(categoryGroup(DEFAULT_EXPENSE_CATEGORIES, "taxes")).toBe("otro");
  });
});

describe("parseCategories", () => {
  it("sin nada válido devuelve las precargadas y nunca lanza", () => {
    expect(parseCategories(null)).toHaveLength(12);
    expect(parseCategories([{ rota: true }])).toHaveLength(12);
  });
  it("descarta lo inválido y las claves repetidas", () => {
    const out = parseCategories([custom(), custom({ name: "Repetida" }), { key: "MAL KEY" }]);
    expect(out.map((c) => c.key)).toEqual(["viajes"]);
  });
});

describe("nombres", () => {
  it("una archivada lo dice y una clave desconocida se muestra tal cual", () => {
    expect(categoryName([custom({ archived_at: "2026-10-01T00:00:00Z" })], "viajes")).toBe("Viajes (archivada)");
    expect(categoryName([], "otra")).toBe("otra");
    expect(categoryName([], null)).toBe("—");
  });
  it("activeCategories saca las archivadas", () => {
    expect(activeCategories([custom(), custom({ key: "vieja", archived_at: "x" })])).toHaveLength(1);
  });
  it("newCategoryKey", () => {
    expect(newCategoryKey("Viajes y Viáticos", [])).toBe("viajes_y_viaticos");
    expect(newCategoryKey("Viajes", ["viajes"])).toBe("viajes_2");
  });
});

describe("validateCategoriesUpdate", () => {
  it("renombrar, recolorear y cambiar de grupo una de sistema está bien", () => {
    const after = base().map((c) => (c.key === "ads_meta" ? { ...c, name: "Ads", color: "#000000", group: "operacion" as const } : c));
    expect(validateCategoriesUpdate(base(), after)).toEqual({ ok: true });
  });
  it("una de sistema no se archiva", () => {
    const after = base().map((c) => (c.key === "ads_meta" ? { ...c, archived_at: "2026-10-01T00:00:00Z" } : c));
    expect(validateCategoriesUpdate(base(), after)).toMatchObject({ ok: false });
  });
  it("no se quita una categoría ni se cambia su clave", () => {
    expect(validateCategoriesUpdate(base(), base().slice(1))).toMatchObject({ ok: false });
    expect(validateCategoriesUpdate(base(), base().map((c) => (c.key === "other" ? { ...c, key: "otros" } : c)))).toMatchObject({ ok: false });
  });
  it("nombre repetido entre activas (sin importar mayúsculas)", () => {
    expect(validateCategoriesUpdate(base(), [...base(), custom({ name: "OTROS" })])).toMatchObject({ ok: false });
  });
  it("un nombre repetido de una archivada no molesta", () => {
    expect(validateCategoriesUpdate(base(), [...base(), custom({ name: "Otros", archived_at: "x" })])).toEqual({ ok: true });
  });
  it("archivar una usada por una plantilla activa se rechaza nombrando la plantilla", () => {
    const before = [...base(), custom()];
    const after = [...base(), custom({ archived_at: "2026-10-01T00:00:00Z" })];
    const res = validateCategoriesUpdate(before, after, { viajes: ["Pasajes"] });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toContain("Pasajes");
    expect(validateCategoriesUpdate(before, after, {})).toEqual({ ok: true });
  });
});
