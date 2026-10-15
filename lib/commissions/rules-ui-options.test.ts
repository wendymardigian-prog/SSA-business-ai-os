import { describe, expect, it } from "vitest";
import { methodOptions, personChoices, productOptions, variantGroups, variantLabel } from "./rules-ui-options";
import type { RulesScreenData } from "./list-load";

const editor: RulesScreenData["editor"] = {
  products: [
    { id: "p1", name: "Mentoría", status: "active", archived: false },
    { id: "p2", name: "Curso", status: "active", archived: false },
    { id: "p3", name: "Viejo", status: "discontinued", archived: true },
  ],
  variants: [
    { id: "v1", productId: "p1", name: "Mensual", archived: false },
    { id: "v2", productId: "p1", name: "Anual", archived: false },
    { id: "v3", productId: "p2", name: "Único", archived: false },
    { id: "v4", productId: "p3", name: "Viejo", archived: true },
  ],
  members: [{ id: "u1", name: "Ana" }],
  methods: [{ key: "whop", name: "Whop", active: true }, { key: "wise", name: "Wise", active: false }],
  utm: { source: [], medium: [], campaign: [], content: [], term: [] },
};

describe("productOptions", () => {
  it("oculta los archivados, salvo los que la regla ya tenía", () => {
    expect(productOptions(editor, []).map((o) => o.label)).toEqual(["Mentoría", "Curso"]);
    expect(productOptions(editor, ["p3"]).map((o) => o.label)).toEqual(["Mentoría", "Curso", "Viejo (archivado)"]);
  });
});

describe("variantGroups", () => {
  it("sin productos elegidos, todas las vigentes agrupadas por producto", () => {
    expect(variantGroups(editor, [], []).map((g) => [g.label, g.options.map((o) => o.label)])).toEqual([["Mentoría", ["Mensual", "Anual"]], ["Curso", ["Único"]]]);
  });
  it("con productos elegidos, solo las de esos productos", () => {
    expect(variantGroups(editor, ["p2"], []).map((g) => g.label)).toEqual(["Curso"]);
  });
  it("una variante ya elegida se mantiene aunque esté archivada o sea de otro producto", () => {
    const groups = variantGroups(editor, ["p2"], ["v4", "v1"]);
    expect(groups.flatMap((g) => g.options.map((o) => o.label)).sort()).toEqual(["Mensual", "Viejo (archivada)", "Único"]);
  });
  it("la etiqueta de una elegida lleva el producto", () => {
    expect(variantLabel(editor, "v1")).toBe("Mentoría · Mensual");
    expect(variantLabel(editor, "zz")).toBe("Una variante que ya no existe");
  });
});

describe("métodos y personas", () => {
  it("los desactivados solo si ya estaban elegidos", () => {
    expect(methodOptions(editor, []).map((o) => o.value)).toEqual(["whop"]);
    expect(methodOptions(editor, ["wise"]).map((o) => o.label)).toEqual(["Whop", "Wise (desactivado)"]);
  });
  it("una persona que salió del equipo se conserva para poder editar la regla", () => {
    expect(personChoices(editor, "u1").map((o) => o.value)).toEqual(["u1"]);
    expect(personChoices(editor, "gone").map((o) => o.value)).toEqual(["u1", "gone"]);
    expect(personChoices(editor, "").map((o) => o.value)).toEqual(["u1"]);
  });
});
