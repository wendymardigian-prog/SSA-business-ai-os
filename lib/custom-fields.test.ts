import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug, isCustomFieldType, CUSTOM_FIELD_TYPES } from "./custom-fields";

describe("slugify", () => {
  it("pasa el nombre a un identificador tipeable", () => {
    expect(slugify("Presupuesto enviado")).toBe("presupuesto_enviado");
  });

  it("saca los acentos", () => {
    expect(slugify("Año de contratación")).toBe("ano_de_contratacion");
  });

  it("colapsa los separadores y no deja guiones sueltos en las puntas", () => {
    expect(slugify("  ¿Cuánto -- paga?  ")).toBe("cuanto_paga");
  });

  it("devuelve null cuando el nombre no deja nada utilizable", () => {
    expect(slugify("🎯🎯")).toBeNull();
    expect(slugify("   ")).toBeNull();
  });

  it("corta los nombres muy largos", () => {
    expect(slugify("a".repeat(80))!.length).toBeLessThanOrEqual(40);
  });
});

describe("uniqueSlug", () => {
  it("usa el slug directo cuando esta libre", () => {
    expect(uniqueSlug("Presupuesto", [])).toBe("presupuesto");
  });

  it("numera cuando ya esta tomado", () => {
    expect(uniqueSlug("Presupuesto", ["presupuesto"])).toBe("presupuesto_2");
    expect(uniqueSlug("Presupuesto", ["presupuesto", "presupuesto_2"])).toBe("presupuesto_3");
  });

  it("inventa uno cuando el nombre no da ninguno", () => {
    const slug = uniqueSlug("🎯", []);
    expect(slug).toMatch(/^campo_[0-9a-f]+$/);
  });

  it("el resultado nunca pasa el tope", () => {
    expect(uniqueSlug("a".repeat(80), ["a".repeat(40)]).length).toBeLessThanOrEqual(40);
  });
});

describe("isCustomFieldType", () => {
  it("acepta los seis tipos del fork", () => {
    for (const t of CUSTOM_FIELD_TYPES) expect(isCustomFieldType(t)).toBe(true);
    expect(CUSTOM_FIELD_TYPES).toHaveLength(6);
  });

  it("rechaza cualquier otra cosa", () => {
    expect(isCustomFieldType("lista")).toBe(false);
    expect(isCustomFieldType(null)).toBe(false);
  });
});
