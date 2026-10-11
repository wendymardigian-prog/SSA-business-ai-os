import { describe, expect, it } from "vitest";
import { acceptProposal, discardProposal, effectiveCategory, groupCategoryProposals, mergeProposal, sanitizeAnalysisCategories, type CategoryRow } from "./categories";
import { EMPTY_CATEGORIES, type CallCategories } from "./rubric";

const cats = (): CallCategories => {
  const c = structuredClone(EMPTY_CATEGORIES);
  c.accepted.objeciones = [{ clave: "precio", nombre: "Precio" }, { clave: "tiempo", nombre: "Falta de tiempo" }];
  c.accepted.dolores = [{ clave: "leads", nombre: "No llegan leads" }];
  return c;
};
const row = (id: string, at: string, objecion: Record<string, unknown> | null, extra: Record<string, unknown> = {}): CategoryRow => ({ id, recorded_at: at, analysis: { ...(objecion ? { objecion } : {}), ...extra } });

describe("sanitizeAnalysisCategories", () => {
  it("una categoria de la lista se deja y no es propuesta", () => {
    const a = sanitizeAnalysisCategories({ objecion: { categoria: "precio", propuesta: true } }, cats(), true);
    expect(a.objecion).toMatchObject({ categoria: "precio", propuesta: false });
  });
  it("una categoria nueva es propuesta solo si el negocio lo permite", () => {
    expect(sanitizeAnalysisCategories({ objecion: { categoria: "falta de confianza" } }, cats(), true).objecion).toMatchObject({ categoria: "falta de confianza", propuesta: true });
    expect(sanitizeAnalysisCategories({ objecion: { categoria: "falta de confianza", propuesta: true } }, cats(), false).objecion).toMatchObject({ categoria: "otra", propuesta: false });
  });
  it("tolera analisis sin categorias o sin forma", () => {
    expect(sanitizeAnalysisCategories(null, cats(), true)).toBeNull();
    expect(sanitizeAnalysisCategories({ resumen: "x" }, cats(), true)).toEqual({ resumen: "x" });
  });
  it("no muta el original", () => {
    const original = { objecion: { categoria: "nueva" } };
    sanitizeAnalysisCategories(original, cats(), true);
    expect(original.objecion).toEqual({ categoria: "nueva" });
  });
});

describe("groupCategoryProposals", () => {
  it("dos analisis que proponen lo mismo son UNA propuesta con 2 llamadas", () => {
    const rows = [
      row("a", "2026-10-01T10:00:00Z", { categoria: "Falta de tiempo libre", propuesta: true }),
      row("b", "2026-10-05T10:00:00Z", { categoria: "falta de tiempo libre", propuesta: true }),
    ];
    const out = groupCategoryProposals(rows, cats());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ group: "objeciones", key: "falta_de_tiempo_libre", calls: 2, lastAt: "2026-10-05T10:00:00Z" });
  });
  it("sugiere unirla con la aceptada mas parecida", () => {
    const out = groupCategoryProposals([row("a", "2026-10-01T10:00:00Z", { categoria: "falta de tiempo", propuesta: true })], cats());
    expect(out[0].suggestion?.clave).toBe("tiempo");
  });
  it("lo que ya esta aceptado, descartado o unido no aparece", () => {
    const c = cats();
    c.discarded.objeciones = ["viejo"];
    c.merged.objeciones = { otra_cosa: "precio" };
    const rows = [
      row("a", "2026-10-01T10:00:00Z", { categoria: "precio", propuesta: true }),
      row("b", "2026-10-01T10:00:00Z", { categoria: "viejo", propuesta: true }),
      row("c", "2026-10-01T10:00:00Z", { categoria: "otra cosa", propuesta: true }),
    ];
    expect(groupCategoryProposals(rows, c)).toEqual([]);
  });
  it("ignora lo que no es propuesta y lo que no tiene analisis", () => {
    const rows = [row("a", "2026-10-01T10:00:00Z", { categoria: "nueva", propuesta: false }), { id: "b", recorded_at: "2026-10-01T10:00:00Z", analysis: null }];
    expect(groupCategoryProposals(rows, cats())).toEqual([]);
  });
  it("junta las propuestas de varios grupos sin mezclarlas", () => {
    const rows = [row("a", "2026-10-01T10:00:00Z", { categoria: "x", propuesta: true }, { dolor: { categoria: "x", propuesta: true } })];
    expect(groupCategoryProposals(rows, cats()).map((p) => p.group).sort()).toEqual(["dolores", "objeciones"]);
  });
  it("ordena por cantidad de llamadas", () => {
    const rows = [
      row("a", "2026-10-01T10:00:00Z", { categoria: "una sola", propuesta: true }),
      row("b", "2026-10-02T10:00:00Z", { categoria: "dos veces", propuesta: true }),
      row("c", "2026-10-03T10:00:00Z", { categoria: "dos veces", propuesta: true }),
    ];
    expect(groupCategoryProposals(rows, cats()).map((p) => p.name)).toEqual(["dos veces", "una sola"]);
  });
  it("no escribe nada: es una lectura pura sobre las filas", () => {
    const rows = [row("a", "2026-10-01T10:00:00Z", { categoria: "x", propuesta: true })];
    const snap = JSON.stringify(rows);
    groupCategoryProposals(rows, cats());
    expect(JSON.stringify(rows)).toBe(snap);
  });
});

describe("las decisiones y como se muestra la categoria", () => {
  it("unir hace desaparecer la propuesta y se muestra la de destino, sin tocar el analisis", () => {
    const rows = [row("a", "2026-10-01T10:00:00Z", { categoria: "falta de tiempo", propuesta: true })];
    const snapshot = JSON.stringify(rows);
    const merged = mergeProposal(cats(), "objeciones", "falta_de_tiempo", "tiempo")!;
    expect(groupCategoryProposals(rows, merged)).toEqual([]);
    expect(effectiveCategory("objeciones", "falta de tiempo", merged)).toEqual({ key: "tiempo", label: "Falta de tiempo", kind: "merged" });
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
  it("no se puede unir con algo que no esta aceptado ni con ella misma", () => {
    expect(mergeProposal(cats(), "objeciones", "x", "no_existe")).toBeNull();
    expect(mergeProposal(cats(), "objeciones", "precio", "precio")).toBeNull();
  });
  it("descartar la saca de la bandeja y se muestra como Otra", () => {
    const rows = [row("a", "2026-10-01T10:00:00Z", { categoria: "ruido", propuesta: true })];
    const c = discardProposal(cats(), "objeciones", "ruido");
    expect(groupCategoryProposals(rows, c)).toEqual([]);
    expect(effectiveCategory("objeciones", "ruido", c)).toEqual({ key: "otra", label: "Otra", kind: "discarded" });
  });
  it("aceptar la suma a la lista y se muestra con su nombre", () => {
    const c = acceptProposal(cats(), "objeciones", "confianza", "Falta de confianza");
    expect(c.accepted.objeciones.map((x) => x.clave)).toContain("confianza");
    expect(effectiveCategory("objeciones", "confianza", c)).toEqual({ key: "confianza", label: "Falta de confianza", kind: "accepted" });
    expect(acceptProposal(c, "objeciones", "confianza", "Otra vez").accepted.objeciones.filter((x) => x.clave === "confianza")).toHaveLength(1);
  });
  it("una pendiente se muestra tal cual, marcada como propuesta; vacio u otra es Otra", () => {
    expect(effectiveCategory("objeciones", "nueva_idea", cats())).toEqual({ key: "nueva_idea", label: "nueva idea", kind: "proposed" });
    expect(effectiveCategory("objeciones", null, cats()).kind).toBe("other");
    expect(effectiveCategory("objeciones", "otra", cats()).kind).toBe("other");
  });
  it("las decisiones no mutan las categorias originales", () => {
    const c = cats();
    const snap = JSON.stringify(c);
    acceptProposal(c, "objeciones", "x", "X");
    discardProposal(c, "objeciones", "y");
    mergeProposal(c, "objeciones", "z", "precio");
    expect(JSON.stringify(c)).toBe(snap);
  });
});
