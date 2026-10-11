import { describe, it, expect } from "vitest";
import { formVariables, variableKey, emptyFormVariables } from "./variables";

const input = () => ({
  form: { id: "f1", name: "Aplicación", type: "custom", slug: "aplicacion" },
  submission: {
    id: "s1",
    created_at: "2026-10-11T10:00:00Z",
    score: null,
    nps_category: null,
    contact_created: true,
    answers: {
      nombre: { value: "Ana" },
      "tipo-negocio": { value: ["A", "B"] },
      archivo: { value: [{ path: "ws/f/k/x.pdf", name: "cv.pdf", size: 1, mime: "application/pdf" }] },
      vacio: { value: "" },
    },
  },
  baseUrl: "https://app.ejemplo.com/",
});

describe("formVariables", () => {
  it("una múltiple ['A','B'] da 'A, B'", () => {
    expect(formVariables(input()).answer.tipo_negocio).toBe("A, B");
  });
  it("las claves con guion pasan a guion bajo", () => {
    expect(variableKey("tipo-negocio")).toBe("tipo_negocio");
    expect(formVariables(input()).answer).toHaveProperty("tipo_negocio");
    expect(formVariables(input()).answer).not.toHaveProperty("tipo-negocio");
  });
  it("un archivo sale como su nombre, nunca como la ruta del bucket", () => {
    const out = formVariables(input());
    expect(out.answer.archivo).toBe("cv.pdf");
    expect(JSON.stringify(out)).not.toContain("ws/f/k");
  });
  it("arma las URLs sin doble barra", () => {
    const out = formVariables(input());
    expect(out.form.url).toBe("https://app.ejemplo.com/f/aplicacion");
    expect(out.submission.url).toBe("https://app.ejemplo.com/dashboard/formularios/f1/respuestas/s1");
  });
  it("lo que falta queda vacío, no 'null'", () => {
    const out = formVariables(input());
    expect(out.submission.score).toBe("");
    expect(out.submission.nps_category).toBe("");
    expect(out.form.category).toBe("");
    expect(out.answer.vacio).toBe("");
  });
  it("emptyFormVariables trae las mismas claves", () => {
    expect(Object.keys(emptyFormVariables().submission).sort()).toEqual(Object.keys(formVariables(input()).submission).sort());
  });
});
