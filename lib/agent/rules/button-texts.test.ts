import { describe, expect, it } from "vitest";
import { buttonTextsFromRows } from "./button-texts";
import { isKnownButtonText } from "./known-buttons";

describe("buttonTextsFromRows", () => {
  it("devuelve los textos normalizados de las filas marcadas", () => {
    expect(buttonTextsFromRows([{ normalized_text: "quiero el pdf", is_button: true }])).toEqual(["quiero el pdf"]);
  });

  it("descarta las filas que no son de botón", () => {
    expect(buttonTextsFromRows([{ normalized_text: "hola", is_button: false }])).toEqual([]);
  });

  it("acepta filas sin la columna: quien consultó ya filtró", () => {
    expect(buttonTextsFromRows([{ normalized_text: "recurso gratuito" }])).toEqual(["recurso gratuito"]);
  });

  it("no repite ni deja vacíos", () => {
    expect(buttonTextsFromRows([
      { normalized_text: "agentes", is_button: true },
      { normalized_text: "agentes", is_button: true },
      { normalized_text: "   ", is_button: true },
      { normalized_text: null, is_button: true },
    ])).toEqual(["agentes"]);
  });

  it("sin filas (o con basura) devuelve la lista vacía", () => {
    expect(buttonTextsFromRows(null)).toEqual([]);
    expect(buttonTextsFromRows(undefined)).toEqual([]);
  });
});

describe("las dos fuentes se suman", () => {
  const extra = buttonTextsFromRows([{ normalized_text: "recurso gratuito", is_button: true }]);

  it("un texto nuevo de la base se reconoce", () => {
    expect(isKnownButtonText("Recurso gratuito", extra)).toBe(true);
  });

  it("sin filas de la base y con la constante vacia (default), nada es un boton conocido", () => {
    expect(isKnownButtonText("Recurso gratuito")).toBe(false);
  });

  it("algo que no es un botón sigue sin serlo", () => {
    expect(isKnownButtonText("hola, cuánto sale el programa?", extra)).toBe(false);
  });
});
