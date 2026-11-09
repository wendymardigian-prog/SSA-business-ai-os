// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { checkDocument, checkHtml, checkImage, lessonThumbnail, programPath } from "./lesson";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

describe("lo que se sube a una clase", () => {
  it("una página HTML de hasta 1 MB", () => {
    expect(checkHtml(enc("<!doctype html><html><body>Hola</body></html>"))).toEqual({ ok: true, mime: "text/html" });
    expect(checkHtml(new Uint8Array(1.2 * 1024 * 1024).fill(60))).toEqual({ ok: false, error: "La página tiene hasta 1 MB" });
    expect(checkHtml(PDF).ok).toBe(false);
  });
  it("un PDF se reconoce por sus bytes", () => {
    expect(checkDocument(PDF)).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkDocument(enc("esto no es un pdf aunque diga .pdf"))).toEqual({ ok: false, error: "Eso no es un PDF" });
  });
  it("una imagen JPG, PNG o WebP de hasta 2 MB", () => {
    expect(checkImage(PNG)).toEqual({ ok: true, mime: "image/png" });
    expect(checkImage(PDF).ok).toBe(false);
  });
});

describe("la vista previa de una clase", () => {
  it("la propia, si no la del video, si no el ícono", () => {
    expect(lessonThumbnail({ thumbnail_path: "a/b.png", thumbnail_url: "https://x" })).toEqual({ kind: "own", path: "a/b.png" });
    expect(lessonThumbnail({ thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg" })).toEqual({ kind: "video", url: "https://i.ytimg.com/vi/x/hqdefault.jpg" });
    expect(lessonThumbnail({ lesson_type: "quiz" })).toEqual({ kind: "icon", type: "quiz" });
  });
  it("la ruta de un archivo empieza por el negocio", () => {
    expect(programPath("w", "p", "i", "Mi Archivo (final).PDF")).toBe("w/p/i/mi-archivo-final-.pdf");
  });
});
