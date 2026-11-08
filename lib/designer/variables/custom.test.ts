import { describe, expect, it } from "vitest";
import { allowedOverrideKeys, MAX_OVERRIDE_LENGTH, MAX_OVERRIDES, parseCustomVarsList, requiredCustomVars, sanitizeOverrides, validateCustomVars } from "./custom";
import { customVarKey } from "./catalog";

describe("variables propias (F49)", () => {
  it("la clave sale del nombre en español con customVarKey y la forma se valida con la misma regla que el servidor", () => {
    const key = customVarKey("Nombre como lo quiere en el certificado");
    expect(key).toBe("nombre_como_lo_quiere_en_el_certificado");
    expect(validateCustomVars([{ key, label: "Nombre como lo quiere en el certificado", sample: "Ana Pérez" }])).toMatchObject({ ok: true });
  });

  it("no choca con una variable del sistema ni con su grupo", () => {
    expect(validateCustomVars([{ key: "contact", label: "Contacto", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "design", label: "Diseño", sample: "" }])).toMatchObject({ ok: false });
  });

  it("no se repite", () => {
    const dup = [
      { key: "curso", label: "Curso", sample: "" },
      { key: "curso", label: "Otro curso", sample: "" },
    ];
    expect(validateCustomVars(dup)).toMatchObject({ ok: false });
  });

  it("parseCustomVarsList lee lo guardado: descarta lo que no tiene la forma esperada y las repetidas", () => {
    expect(
      parseCustomVarsList([
        { key: "curso", label: "Curso", sample: "Curso de ejemplo", default: "Curso general" },
        { key: "curso", label: "Repetida", sample: "" },
        { key: "Mala Clave", label: "x" },
        { key: "sin_nombre" },
        null,
        "texto",
        { key: "nota", label: "Nota", sample: 5, default: 7 },
      ]),
    ).toEqual([
      { key: "curso", label: "Curso", sample: "Curso de ejemplo", default: "Curso general" },
      { key: "nota", label: "Nota", sample: "", default: null },
    ]);
    expect(parseCustomVarsList(null)).toEqual([]);
    expect(parseCustomVarsList({})).toEqual([]);
  });

  it("obligatorias: las que el documento usa y no tienen valor por defecto", () => {
    const vars = [
      { key: "nombre", label: "Nombre", sample: "", default: null },
      { key: "curso", label: "Curso", sample: "", default: "Curso general" },
      { key: "vacia", label: "Vacía", sample: "", default: "   " },
      { key: "no_se_usa", label: "No se usa", sample: "", default: null },
    ];
    expect(requiredCustomVars(vars, ["nombre", "curso", "vacia", "contact.email"]).map((v) => v.key)).toEqual(["nombre", "vacia"]);
  });
});

describe("sanitizeOverrides: lo que manda el navegador como valores a mano", () => {
  const allowed = allowedOverrideKeys([{ key: "nombre", label: "Nombre", sample: "" }], ["prueba.nombre"]);

  it("deja pasar las claves propias, las del sistema y las de un módulo; descarta el resto", () => {
    expect(sanitizeOverrides({ nombre: " Ana ", "contact.email": "a@b.co", "prueba.nombre": "x", inventada: "no", "workspace.name": "Mi academia" }, allowed)).toEqual({
      ok: true,
      overrides: { nombre: "Ana", "contact.email": "a@b.co", "prueba.nombre": "x", "workspace.name": "Mi academia" },
    });
  });

  it("el código no se puede pisar: es el mismo del link", () => {
    expect(sanitizeOverrides({ "design.code": "AAAA-BBBB-CCCC", nombre: "Ana" }, allowed)).toEqual({ ok: true, overrides: { nombre: "Ana" } });
  });

  it("los valores vacíos no se pasan", () => {
    expect(sanitizeOverrides({ nombre: "   " }, allowed)).toEqual({ ok: true, overrides: {} });
  });

  it("un valor que no es texto o es larguísimo se rechaza con un mensaje claro", () => {
    expect(sanitizeOverrides({ nombre: 5 }, allowed)).toEqual({ ok: false, error: "Un dato de la pieza no es texto." });
    expect(sanitizeOverrides({ nombre: "x".repeat(MAX_OVERRIDE_LENGTH + 1) }, allowed)).toMatchObject({ ok: false });
    expect(sanitizeOverrides("texto", allowed)).toMatchObject({ ok: false });
    expect(sanitizeOverrides([], allowed)).toMatchObject({ ok: false });
  });

  it("tiene tope de cantidad", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_OVERRIDES + 1 }, (_, i) => [`k${i}`, "x"]));
    expect(sanitizeOverrides(many, allowed)).toMatchObject({ ok: false });
  });

  it("sin nada, no hay valores", () => {
    expect(sanitizeOverrides(undefined, allowed)).toEqual({ ok: true, overrides: {} });
    expect(sanitizeOverrides(null, allowed)).toEqual({ ok: true, overrides: {} });
  });
});
