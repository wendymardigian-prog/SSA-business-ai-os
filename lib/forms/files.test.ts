import { describe, it, expect } from "vitest";
import { filesOfAnswers, isFileOfSubmission } from "./files";

const prefix = "ws/form/key";
const answers = {
  nombre: { value: "Ana" },
  cv: { value: [{ path: `${prefix}/cv/a.pdf`, name: "cv.pdf", size: 10, mime: "application/pdf" }] },
  multi: { value: ["A", "B"] },
};

describe("filesOfAnswers", () => {
  it("junta solo los archivos", () => {
    expect(filesOfAnswers(answers).map((f) => f.name)).toEqual(["cv.pdf"]);
    expect(filesOfAnswers(null)).toEqual([]);
  });
});

describe("filesOfAnswers · entregas del portal", () => {
  it("lee la lista directa que guarda el portal", () => {
    const f = { path: "w/f/c/a.pdf", name: "a.pdf", size: 10, mime: "application/pdf" };
    expect(filesOfAnswers({ doc: [f], txt: "hola" })).toEqual([f]);
    expect(isFileOfSubmission({ doc: [f] }, "w/f/c", "w/f/c/a.pdf")).toBe(true);
    expect(isFileOfSubmission({ doc: [f] }, "w/f/otra", "w/f/c/a.pdf")).toBe(false);
  });
});

describe("isFileOfSubmission", () => {
  it("solo un archivo de esa respuesta, dentro de su carpeta", () => {
    expect(isFileOfSubmission(answers, prefix, `${prefix}/cv/a.pdf`)).toBe(true);
  });

  it("una ruta de otra respuesta, inventada o con .. no sirve", () => {
    expect(isFileOfSubmission(answers, prefix, "otro-ws/form/key/cv/a.pdf")).toBe(false);
    expect(isFileOfSubmission(answers, prefix, `${prefix}/cv/b.pdf`)).toBe(false);
    expect(isFileOfSubmission(answers, prefix, `${prefix}/../x/a.pdf`)).toBe(false);
    expect(isFileOfSubmission(answers, null, `${prefix}/cv/a.pdf`)).toBe(false);
  });
});
