import { describe, expect, it } from "vitest";
import { keepKnownIds, validateFolderName } from "./folders";
import { countIncludedDocuments } from "@/lib/agent/screen";

describe("carpetas de la base", () => {
  it("el nombre se recorta y no puede ir vacío ni pasar de 80", () => {
    expect(validateFolderName("  Precios   2026 ")).toEqual({ ok: true, name: "Precios 2026" });
    expect(validateFolderName("   ").ok).toBe(false);
    expect(validateFolderName("x".repeat(81)).ok).toBe(false);
  });

  it("keepKnownIds deja solo los que existen, sin repetir", () => {
    expect(keepKnownIds(["a", "b", "a", "z"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("cuántos documentos lee el agente", () => {
  const docs = [
    { id: "d1", title: "Precios", tags: ["ventas"], internalOnly: false, status: "ready", folderId: "f1" },
    { id: "d2", title: "Envíos", tags: [], internalOnly: false, status: "ready", folderId: null },
    { id: "d3", title: "Equipo", tags: ["rrhh"], internalOnly: false, status: "ready", folderId: "f2" },
    { id: "d4", title: "Márgenes", tags: ["ventas"], internalOnly: true, status: "ready", folderId: "f1" },
  ];

  it("sin nada elegido, toda la base salvo lo interno", () => {
    expect(countIncludedDocuments(docs, [])).toEqual({ included: 3, internalExcluded: 1, outsideTags: 0 });
  });

  it("por carpeta: solo los de esa carpeta, y lo interno nunca", () => {
    expect(countIncludedDocuments(docs, [], [], ["f1"])).toEqual({ included: 1, internalExcluded: 1, outsideTags: 2 });
  });

  it("documento suelto y carpeta suman", () => {
    expect(countIncludedDocuments(docs, [], ["d2"], ["f2"])).toEqual({ included: 2, internalExcluded: 1, outsideTags: 1 });
  });
});
