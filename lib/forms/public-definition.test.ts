import { describe, it, expect } from "vitest";
import { containsText, findForbiddenKeys, toPublicField, toPublicFields } from "./public-definition";
import { newField, type FormField } from "./fields";

describe("toPublicField", () => {
  it("un oculto fixed no se devuelve y su valor no aparece en ningún lado", () => {
    const fixed: FormField = { ...newField("hidden", "canal"), hidden: { source: "fixed", value: "octubre-secreto" } };
    expect(toPublicField(fixed)).toBeNull();
    const all = toPublicFields([newField("email", "email"), fixed]);
    expect(containsText(all, "octubre-secreto")).toBe(false);
  });

  it("un oculto de URL o de atribución solo lleva su fuente", () => {
    const url: FormField = { ...newField("hidden", "campana"), hidden: { source: "url_param", param: "utm_campaign" } };
    expect(toPublicField(url)).toEqual({ key: "campana", type: "hidden", hidden: { source: "url_param", param: "utm_campaign" } });
    const attr: FormField = { ...newField("hidden", "origen"), hidden: { source: "attribution", param: "utm_source" } };
    expect(toPublicField(attr)?.hidden?.source).toBe("attribution");
  });

  it("un campo normal conserva solo la lista blanca (el id interno no sale)", () => {
    const field = { ...newField("single_select", "plan"), options: ["A", "B"], required: true };
    const pub = toPublicField(field)!;
    expect(Object.keys(pub).sort()).toEqual(["key", "label", "options", "required", "type"].sort());
    expect(pub).not.toHaveProperty("id");
  });

  it("incluye condiciones y prellenado", () => {
    const field: FormField = {
      ...newField("short_text", "b"),
      visibility: { rootConjunction: "and", conditions: [{ fieldKey: "a", operator: "is", value: "x" }], groups: [] },
      prefill: { params: ["b"], behavior: "locked" },
    };
    const pub = toPublicField(field)!;
    expect(pub.visibility).toBeDefined();
    expect(pub.prefill).toEqual({ params: ["b"], behavior: "locked" });
  });
});

describe("findForbiddenKeys", () => {
  it("recorre el JSON entero", () => {
    expect(findForbiddenKeys({ a: [{ b: { workspace_id: "x" } }], success: 1 })).toEqual([".a[0].b.workspace_id", ".success"]);
    expect(findForbiddenKeys({ fields: [{ key: "a" }] })).toEqual([]);
  });
});
