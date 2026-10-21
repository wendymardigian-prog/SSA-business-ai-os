import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug, isCustomFieldType, CUSTOM_FIELD_TYPES, normalizeCustomValue, displayCustomValue } from "./custom-fields";

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

describe("normalizeCustomValue", () => {
  const ok = (type: string, raw: string) => {
    const r = normalizeCustomValue(type, raw);
    return r.ok ? r.value : `ERROR:${r.reason}`;
  };

  it("número: coma o punto decimal, miles con el otro separador", () => {
    expect(ok("number", "3")).toBe("3");
    expect(ok("number", " 4 ")).toBe("4");
    expect(ok("number", "3,5")).toBe("3.5");
    expect(ok("number", "3.5")).toBe("3.5");
    expect(ok("number", "1.500,5")).toBe("1500.5");
    expect(ok("number", "1,500.5")).toBe("1500.5");
    expect(ok("number", "-2")).toBe("-2");
    expect(ok("number", "tres")).toBe("ERROR:no_es_un_numero");
    expect(ok("number", "3 personas")).toBe("ERROR:no_es_un_numero");
    expect(ok("number", "")).toBe("ERROR:no_es_un_numero");
  });

  it("sí/no: en castellano y en inglés", () => {
    for (const t of ["sí", "Si", "true", "1", "yes", "Verdadero"]) expect(ok("boolean", t)).toBe("true");
    for (const t of ["no", "NO", "false", "0", "falso"]) expect(ok("boolean", t)).toBe("false");
    expect(ok("boolean", "tal vez")).toBe("ERROR:no_es_si_no");
  });

  it("fecha: AAAA-MM-DD o DD/MM/AAAA, sin mover el día por la zona", () => {
    expect(ok("date", "2026-10-21")).toBe("2026-10-21");
    expect(ok("date", "2026-10-21T23:30:00-03:00")).toBe("2026-10-21");
    expect(ok("date", "21/10/2026")).toBe("2026-10-21");
    expect(ok("date", "5-1-2000")).toBe("2000-01-05");
    expect(ok("date", "31/02/2026")).toBe("ERROR:fecha_invalida");
    expect(ok("date", "10/21/2026")).toBe("ERROR:fecha_invalida");
    expect(ok("date", "mañana")).toBe("ERROR:fecha_invalida");
  });

  it("url y email", () => {
    expect(ok("url", "https://ejemplo.com/a")).toBe("https://ejemplo.com/a");
    expect(ok("url", "ejemplo.com")).toBe("ERROR:url_invalida");
    expect(ok("email", " Ana@Ejemplo.COM ")).toBe("ana@ejemplo.com");
    expect(ok("email", "ana@")).toBe("ERROR:email_invalido");
  });

  it("texto: se guarda recortado", () => {
    expect(ok("text", "  hola  ")).toBe("hola");
  });
});

describe("displayCustomValue", () => {
  it("muestra Sí/No y la fecha en DD/MM/AAAA", () => {
    expect(displayCustomValue("boolean", "true")).toBe("Sí");
    expect(displayCustomValue("boolean", "false")).toBe("No");
    expect(displayCustomValue("date", "2026-10-21")).toBe("21/10/2026");
    expect(displayCustomValue("number", "3")).toBe("3");
    expect(displayCustomValue("text", null)).toBe("");
  });
});
