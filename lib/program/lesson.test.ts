// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { checkDocument, checkHtml, checkImage, checkResource, lessonThumbnail, programPath, RESOURCE_MAX } from "./lesson";

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

describe("un recurso descargable", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);

  it("acepta un zip que se declara zip, por el tipo o por el nombre", () => {
    expect(checkResource(zip, "application/zip", "plugin.zip")).toEqual({ ok: true, mime: "application/zip" });
    expect(checkResource(zip, "application/x-zip-compressed", "plugin.zip")).toEqual({ ok: true, mime: "application/zip" });
    expect(checkResource(zip, "", "Metodo-Builder.ZIP")).toEqual({ ok: true, mime: "application/zip" });
  });

  it("no acepta un zip que dice ser otra cosa, ni un ejecutable renombrado", () => {
    expect(checkResource(zip, "application/pdf", "nota.pdf").ok).toBe(false);
    expect(checkResource(exe, "application/zip", "plugin.zip").ok).toBe(false);
  });

  it("un docx sigue siendo un docx", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(checkResource(zip, docx, "a.docx")).toEqual({ ok: true, mime: docx });
  });

  it("hasta 45 MB", () => {
    const big = new Uint8Array(RESOURCE_MAX + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    expect(checkResource(big, "application/zip", "plugin.zip")).toEqual({ ok: false, error: "Cada recurso tiene hasta 45 MB" });
  });
});
