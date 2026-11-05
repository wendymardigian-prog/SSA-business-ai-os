import { describe, it, expect } from "vitest";
import { formVariables, readableDateAnswer, variableKey, emptyFormVariables } from "./variables";

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
  publicBaseUrl: "https://links.ejemplo.com",
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
  it("arma las URLs sin doble barra: el formulario con el dominio del negocio, la respuesta con el del panel", () => {
    const out = formVariables(input());
    expect(out.form.url).toBe("https://links.ejemplo.com/f/aplicacion");
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

describe("las fechas para leer", () => {
  it.each([
    ["2026-10-06", "6 de octubre de 2026"],
    ["2026-11-09T19:00:00-06:00", "lunes 9 de noviembre de 2026, 19:00"],
    ["2026-11-09T07:05:00.000+01:00", "lunes 9 de noviembre de 2026, 07:05"],
  ])("%s", (raw, expected) => {
    expect(readableDateAnswer(raw)).toBe(expected);
  });

  it("no cambia lo que no es una fecha, ni una hora sin desfase (no se sabe de qué lugar es)", () => {
    for (const text of ["Ana", "2026-02-31", "2026-11-09T19:00:00Z", "2026-11-09T19:00:00", "Nos vemos el 2026-10-06", ""]) {
      expect(readableDateAnswer(text)).toBe(text);
    }
  });

  it("el dia no se corre aunque la máquina esté en otra zona", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/Mexico_City";
    try {
      expect(readableDateAnswer("2026-10-06")).toBe("6 de octubre de 2026");
    } finally {
      process.env.TZ = before;
    }
  });

  it("answer para leer, answer_raw como se guardó", () => {
    const base = input();
    base.submission.answers = { clase_fecha: { value: "2026-11-09T19:00:00-06:00" } } as never;
    const out = formVariables(base);
    expect(out.answer.clase_fecha).toBe("lunes 9 de noviembre de 2026, 19:00");
    expect(out.answer_raw.clase_fecha).toBe("2026-11-09T19:00:00-06:00");
  });
});

describe("una pregunta sin responder", () => {
  it("queda vacía, no como {{answer.x}} literal", () => {
    const out = formVariables({ ...input(), fieldKeys: ["nombre", "opcional-oculta"] });
    expect(out.answer.opcional_oculta).toBe("");
    expect(out.answer_raw.opcional_oculta).toBe("");
    expect(out.answer.nombre).toBe("Ana");
  });
});
