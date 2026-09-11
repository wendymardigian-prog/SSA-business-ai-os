import { describe, it, expect } from "vitest";
import {
  validateFileSize,
  validateTitle,
  normalizeTags,
  titleFromFilename,
  storagePathFor,
  formatBytes,
  MAX_FILE_BYTES,
  MAX_TAGS,
} from "./validate";

describe("validateFileSize", () => {
  it("acepta un archivo normal", () => {
    expect(validateFileSize(1024).ok).toBe(true);
    expect(validateFileSize(MAX_FILE_BYTES).ok).toBe(true);
  });

  it("rechaza uno vacio y uno que se pasa, diciendo cuanto pesa", () => {
    expect(validateFileSize(0).ok).toBe(false);

    const r = validateFileSize(MAX_FILE_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("25,0 MB");
    }
  });
});

describe("validateTitle", () => {
  it("exige un titulo con algo adentro", () => {
    expect(validateTitle("").ok).toBe(false);
    expect(validateTitle("   ").ok).toBe(false);
    expect(validateTitle("Politica de precios").ok).toBe(true);
  });

  it("corta los titulos absurdamente largos", () => {
    expect(validateTitle("x".repeat(201)).ok).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("normaliza a minuscula y saca repetidos", () => {
    // "Precios" y "precios" tienen que ser la misma etiqueta en el filtro.
    expect(normalizeTags("Precios, precios,  PRECIOS ")).toEqual(["precios"]);
  });

  it("acepta string separado por coma o array", () => {
    expect(normalizeTags("faq, precios")).toEqual(["faq", "precios"]);
    expect(normalizeTags(["faq", "precios"])).toEqual(["faq", "precios"]);
  });

  it("descarta las vacias", () => {
    expect(normalizeTags("faq,,  , precios")).toEqual(["faq", "precios"]);
  });

  it("pone un techo a la cantidad", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(normalizeTags(muchas)).toHaveLength(MAX_TAGS);
  });
});

describe("titleFromFilename", () => {
  it("saca la extension y limpia guiones", () => {
    expect(titleFromFilename("politica-de-reembolsos.pdf")).toBe("politica de reembolsos");
    expect(titleFromFilename("Lista_de_precios.docx")).toBe("Lista de precios");
  });

  it("con un nombre sin extension usa el nombre entero", () => {
    expect(titleFromFilename("README")).toBe("README");
  });
});

describe("storagePathFor", () => {
  it("arma la ruta con el workspace y el id del documento", () => {
    expect(storagePathFor("ws-1", "doc-1", "application/pdf")).toBe("ws-1/doc-1.pdf");
    expect(storagePathFor("ws-1", "doc-1", "text/markdown")).toBe("ws-1/doc-1.md");
  });

  it("el nombre original del archivo NUNCA entra en la ruta", () => {
    // El nombre lo elige quien sube: podria traer "../" o caracteres que
    // signifiquen algo para el storage. La ruta se arma solo con ids.
    const path = storagePathFor("ws-1", "doc-1", "application/pdf");
    expect(path).not.toContain("..");
    expect(path).toMatch(/^[\w-]+\/[\w-]+\.pdf$/);
  });
});

describe("formatBytes", () => {
  it("muestra el tamano en algo que se lea", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2,0 KB");
    expect(formatBytes(MAX_FILE_BYTES)).toBe("25,0 MB");
  });
});
