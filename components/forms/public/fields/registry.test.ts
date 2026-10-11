import { describe, it, expect } from "vitest";
import { FIELD_RENDERERS } from "./registry";
import { FIELD_TYPE_LABELS, FORM_FIELD_TYPES } from "@/lib/forms/fields";

describe("paridad de los 13 tipos de campo", () => {
  it("hay 13 tipos", () => {
    expect(FORM_FIELD_TYPES).toHaveLength(13);
  });

  it("cada tipo tiene etiqueta en el editor y entrada en el renderizador público", () => {
    for (const type of FORM_FIELD_TYPES) {
      expect(FIELD_TYPE_LABELS[type], `etiqueta de ${type}`).toBeTruthy();
      expect(type in FIELD_RENDERERS, `renderizador de ${type}`).toBe(true);
    }
  });

  it("el único sin interfaz es el oculto", () => {
    const withoutUi = FORM_FIELD_TYPES.filter((t) => FIELD_RENDERERS[t] === null);
    expect(withoutUi).toEqual(["hidden"]);
  });

  it("no sobran entradas", () => {
    expect(Object.keys(FIELD_RENDERERS).sort()).toEqual([...FORM_FIELD_TYPES].sort());
  });
});
