import { describe, it, expect } from "vitest";
import { detectMimeType, extractMarkdown, normalize, extensionOf } from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);

/** Los primeros bytes de un PDF real. */
const pdfBytes = (rest = "") => enc(`%PDF-1.7\n${rest}`);

/** Los primeros bytes de cualquier ZIP (un .docx lo es). */
const zipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

describe("detectMimeType mira el contenido, no la extension", () => {
  it("reconoce un PDF por su firma", () => {
    const r = detectMimeType(pdfBytes(), "loquesea.txt");
    expect(r).toEqual({ ok: true, mime: "application/pdf" });
  });

  it("un ejecutable renombrado a .pdf NO pasa como PDF", () => {
    // Este es el caso que justifica todo este archivo: la extension y el
    // Content-Type los elige quien sube; los primeros bytes, no.
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const r = detectMimeType(exe, "factura.pdf");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("No se reconoce");
  });

  it("un texto renombrado a .pdf se detecta como texto, no como PDF", () => {
    const r = detectMimeType(enc("hola, esto es texto"), "documento.pdf");
    expect(r).toEqual({ ok: true, mime: "text/plain" });
  });

  it("reconoce un DOCX: firma ZIP mas extension .docx", () => {
    const r = detectMimeType(zipBytes(), "contrato.docx");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toContain("wordprocessingml");
  });

  it("un ZIP que no es .docx se rechaza con una explicacion util", () => {
    const r = detectMimeType(zipBytes(), "fotos.zip");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(".docx");
  });

  it("distingue .md de .txt, que para el contenido son iguales", () => {
    expect(detectMimeType(enc("# Titulo"), "guia.md")).toEqual({ ok: true, mime: "text/markdown" });
    expect(detectMimeType(enc("# Titulo"), "guia.markdown")).toEqual({ ok: true, mime: "text/markdown" });
    expect(detectMimeType(enc("# Titulo"), "guia.txt")).toEqual({ ok: true, mime: "text/plain" });
  });

  it("un binario con bytes nulos no pasa como texto", () => {
    const binario = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0x00]);
    expect(detectMimeType(binario, "imagen.txt").ok).toBe(false);
  });

  it("un UTF-8 roto no pasa como texto", () => {
    const roto = new Uint8Array([0xc3, 0x28, 0xa0, 0xa1, 0xff, 0xfe, 0x41, 0x42]);
    expect(detectMimeType(roto, "raro.txt").ok).toBe(false);
  });

  it("acepta acentos y emoji (UTF-8 valido)", () => {
    const r = detectMimeType(enc("configuración, mañana 🚀"), "notas.txt");
    expect(r).toEqual({ ok: true, mime: "text/plain" });
  });

  it("un archivo vacio se rechaza", () => {
    const r = detectMimeType(new Uint8Array(0), "vacio.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("vacio");
  });
});

describe("extensionOf", () => {
  it("saca la extension en minuscula", () => {
    expect(extensionOf("Documento.PDF")).toBe("pdf");
    expect(extensionOf("archivo.tar.gz")).toBe("gz");
  });

  it("sin extension devuelve vacio", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("termina.")).toBe("");
  });
});

describe("extractMarkdown", () => {
  it("un .txt se convierte tal cual", async () => {
    const r = await extractMarkdown(enc("Los precios arrancan en 500 dolares."), "text/plain");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markdown).toBe("Los precios arrancan en 500 dolares.");
  });

  it("un .md conserva el formato", async () => {
    const md = "# Precios\n\n- Basico: 500\n- Avanzado: 1200";
    const r = await extractMarkdown(enc(md), "text/markdown");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markdown).toBe(md);
  });

  it("un texto vacio da error legible en vez de indexar la nada", async () => {
    const r = await extractMarkdown(enc("   \n\n  "), "text/plain");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no tiene texto");
  });

  it("un PDF danado no tumba el proceso: devuelve un error legible", async () => {
    const r = await extractMarkdown(pdfBytes("basura que no es un pdf"), "application/pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Nunca el error crudo de la libreria, que puede traer parte del documento.
      expect(r.error).toMatch(/no se pudo leer|no tiene texto/i);
    }
  });

  it("un DOCX invalido no tumba el proceso", async () => {
    const r = await extractMarkdown(
      zipBytes(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no se pudo leer/i);
  });
});

describe("normalize", () => {
  it("unifica saltos de linea y saca relleno", () => {
    expect(normalize("hola\r\n\r\n\r\n\r\nchau")).toBe("hola\n\nchau");
    expect(normalize("mucho     espacio")).toBe("mucho espacio");
    expect(normalize("  bordes  ")).toBe("bordes");
  });

  it("conserva el corte de parrafo, que es donde el chunker corta", () => {
    expect(normalize("uno\n\ndos")).toBe("uno\n\ndos");
  });
});

/**
 * La cadena real, con archivos de verdad.
 *
 * Los tests de arriba usan bytes falsos: prueban la deteccion, no la
 * conversion. Estos generan un PDF y un DOCX validos y los hacen pasar por
 * unpdf y mammoth de verdad, que es lo que se rompe cuando cambia una version.
 */
describe("archivos reales, no bytes falsos", () => {
  it("un PDF de verdad: se detecta, se convierte y el texto sobrevive", async () => {
    const { makePdf } = await import("./extract.fixtures");
    const pdf = makePdf("El plan avanzado cuesta 1200 dolares por mes.");

    expect(detectMimeType(pdf, "precios.pdf")).toEqual({ ok: true, mime: "application/pdf" });

    const r = await extractMarkdown(pdf, "application/pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markdown).toContain("1200 dolares por mes");
  });

  it("un DOCX de verdad: se detecta y conserva la estructura de titulos", async () => {
    const { makeDocx } = await import("./extract.fixtures");
    const docx = await makeDocx("Politica de reembolsos", [
      "Se devuelve el dinero dentro de los 30 dias.",
    ]);

    const det = detectMimeType(docx, "politica.docx");
    expect(det.ok).toBe(true);

    const r = await extractMarkdown(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      // El titulo llega como titulo de markdown: es lo que le da contexto al chunk.
      expect(r.markdown).toContain("# Politica de reembolsos");
      expect(r.markdown).toContain("30 dias.");
      // Y sin los escapes que mammoth agrega de mas.
      expect(r.markdown).not.toContain("\\.");
    }
  });
});
