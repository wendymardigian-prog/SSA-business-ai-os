import { describe, it, expect } from "vitest";
import { answerToText, cellFor, parseResponseFilters, responseColumns } from "./responses";

const fields = [
  { key: "nombre", label: "Nombre", type: "short_text" as const },
  { key: "plan", label: "Plan", type: "single_select" as const },
];

describe("responseColumns", () => {
  it("una columna por campo de la versión vigente", () => {
    expect(responseColumns(fields, []).map((c) => c.key)).toEqual(["nombre", "plan"]);
  });

  it("una respuesta vieja con un campo que la versión vigente borró muestra su columna con la etiqueta vieja", () => {
    const subs = [{ answers: { nombre: { label: "Nombre", type: "short_text", value: "Ana" }, edad: { label: "¿Cuántos años tenés?", type: "number", value: 30 } } }];
    const cols = responseColumns(fields, subs);
    expect(cols.map((c) => c.key)).toEqual(["nombre", "plan", "edad"]);
    expect(cols[2]).toMatchObject({ label: "¿Cuántos años tenés?", removed: true });
    expect(cols[0].removed).toBe(false);
  });

  it("usa la etiqueta más reciente del campo borrado (la primera fila es la más nueva)", () => {
    const subs = [
      { answers: { edad: { label: "Edad (nueva)", type: "number", value: 1 } } },
      { answers: { edad: { label: "Edad (vieja)", type: "number", value: 2 } } },
    ];
    expect(responseColumns([], subs)[0].label).toBe("Edad (nueva)");
  });

  it("un campo oculto sin respuestas no hace columna", () => {
    const cols = responseColumns([{ key: "utm", label: "UTM", type: "hidden" }], []);
    expect(cols).toEqual([]);
  });
});

describe("answerToText", () => {
  it("convierte cada forma de valor", () => {
    expect(answerToText(null)).toBe("");
    expect(answerToText(true)).toBe("Sí");
    expect(answerToText(false)).toBe("No");
    expect(answerToText(["a", "b"])).toBe("a, b");
    expect(answerToText(["a", "b"], "; ")).toBe("a; b");
    expect(answerToText(0)).toBe("0");
  });

  it("un archivo muestra su nombre, nunca la ruta del bucket", () => {
    const text = answerToText([{ path: "ws/form/key/abc.pdf", name: "cv.pdf", size: 10, mime: "application/pdf" }]);
    expect(text).toBe("cv.pdf");
    expect(text).not.toContain("ws/");
  });

  it("cellFor", () => {
    const row = { answers: { nombre: { label: "Nombre", type: "short_text", value: "Ana" } } };
    expect(cellFor(row, { key: "nombre" })).toBe("Ana");
    expect(cellFor(row, { key: "otro" })).toBe("");
  });
});

describe("parseResponseFilters", () => {
  it("valida lo que viene de la URL", () => {
    expect(parseResponseFilters({ desde: "2026-10-01", hasta: "mal", estado: "spam", contacto: "sin", pagina: "3" })).toEqual({
      from: "2026-10-01",
      to: null,
      status: "spam",
      contact: "without",
      page: 3,
    });
    expect(parseResponseFilters({ estado: "hack", pagina: "-2" })).toMatchObject({ status: "all", page: 1 });
  });
});

import { orderedAnswers } from "./responses";

describe("orderedAnswers", () => {
  const a = (value: string) => ({ label: value, type: "short_text", value });

  it("sigue el orden de la versión y deja al final lo que ya no está", () => {
    const out = orderedAnswers({ nps: a("9"), viejo: a("x"), nombre: a("Ana"), email: a("a@x") }, ["nombre", "email", "nps"]);
    expect(out.map(([k]) => k)).toEqual(["nombre", "email", "nps", "viejo"]);
  });

  it("ignora campos de la versión que no tienen respuesta", () => {
    expect(orderedAnswers({ nombre: a("Ana") }, ["nombre", "telefono"]).map(([k]) => k)).toEqual(["nombre"]);
  });
});
