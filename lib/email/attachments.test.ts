/**
 * Los adjuntos de un correo (F64).
 */

import { describe, it, expect } from "vitest";
import { humanSize, parseAttachments } from "./attachments";

describe("leer los adjuntos guardados (F64)", () => {
  it("devuelve los que tienen path", () => {
    expect(
      parseAttachments({
        files: [
          { filename: "guia.pdf", contentType: "application/pdf", storagePath: "ws/1/guia.pdf", sizeBytes: 2048 },
        ],
      }),
    ).toEqual([
      { filename: "guia.pdf", contentType: "application/pdf", storagePath: "ws/1/guia.pdf", sizeBytes: 2048 },
    ]);
  });

  it("uno sin path se descarta: no hay de donde bajarlo", () => {
    expect(parseAttachments({ files: [{ filename: "roto.pdf" }] })).toEqual([]);
  });

  it("lo que no tiene la forma esperada no rompe la bandeja", () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments({ files: "texto" })).toEqual([]);
    expect(parseAttachments({ otra: "cosa" })).toEqual([]);
  });

  it("completa lo que falta en vez de mostrar undefined", () => {
    const [file] = parseAttachments({ files: [{ storagePath: "ws/1/x" }] });

    expect(file.filename).toBe("adjunto");
    expect(file.contentType).toBe("application/octet-stream");
  });
});

describe("el tamaño en palabras (F64)", () => {
  it("se muestra en la unidad que corresponde", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2 KB");
    expect(humanSize(1_500_000)).toBe("1,4 MB");
  });

  it("sin tamaño no se muestra nada", () => {
    expect(humanSize(null)).toBeNull();
    expect(humanSize(0)).toBeNull();
  });
});
