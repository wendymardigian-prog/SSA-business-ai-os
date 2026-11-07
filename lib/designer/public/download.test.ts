import { describe, expect, it } from "vitest";
import { attachmentHeader, contentTypeOf, parseDownloadQuery, primaryDownload, publicDownloadName } from "./download";

const q = (query: string, format: Parameters<typeof parseDownloadQuery>[1], pages: number) => parseDownloadQuery(new URLSearchParams(query), format, pages);

describe("lo principal que se descarga", () => {
  it("PDF en impresos y presentaciones", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h", "wide"] as const) expect(primaryDownload(format, 3)).toEqual({ formato: "pdf", label: "Descargar PDF" });
  });

  it("imágenes en redes: un ZIP si son varias, un PNG si es una", () => {
    expect(primaryDownload("sq", 5)).toEqual({ formato: "zip", label: "Descargar imágenes (ZIP)" });
    expect(primaryDownload("story", 1)).toEqual({ formato: "png", label: "Descargar imagen", pagina: 1 });
  });

  it("una página web no se descarga", () => {
    expect(primaryDownload("web", 1)).toBeNull();
  });
});

describe("?formato=pdf|zip|png&pagina=N", () => {
  it("sin formato, lo principal", () => {
    expect(q("", "carta_h", 1)).toEqual({ ok: true, formato: "pdf", pagina: 1 });
    expect(q("", "v45", 3)).toEqual({ ok: true, formato: "zip", pagina: 1 });
  });

  it("un PNG lleva su página (desde 1)", () => {
    expect(q("formato=png&pagina=3", "v45", 4)).toEqual({ ok: true, formato: "png", pagina: 3 });
    expect(q("formato=png", "v45", 4)).toEqual({ ok: true, formato: "png", pagina: 1 });
  });

  it("lo raro se rechaza: formato desconocido, página fuera de rango o mal escrita, ZIP de una sola página, web", () => {
    for (const query of ["formato=exe", "formato=PDF ", "formato=png&pagina=0", "formato=png&pagina=5", "formato=png&pagina=-1", "formato=png&pagina=1.5", "formato=png&pagina=../../x", "formato=zip"]) {
      expect(q(query, query === "formato=zip" ? "sq" : "v45", query === "formato=zip" ? 1 : 4)).toEqual({ ok: false });
    }
    expect(q("formato=pdf", "web", 1)).toEqual({ ok: false });
  });

  it("la página solo importa con PNG", () => {
    expect(q("formato=pdf&pagina=99", "carta_h", 1)).toEqual({ ok: true, formato: "pdf", pagina: 1 });
  });
});

describe("nombre legible del archivo", () => {
  it("certificado-ana-perez.pdf", () => {
    expect(publicDownloadName("Certificado · Ana Pérez", "pdf", 1, 1)).toBe("certificado-ana-perez.pdf");
  });

  it("un PNG de una pieza de varias páginas lleva su número; el de una sola, no", () => {
    expect(publicDownloadName("Carrusel de lanzamiento", "png", 2, 5)).toBe("carrusel-de-lanzamiento-pagina-2.png");
    expect(publicDownloadName("Historia", "png", 1, 1)).toBe("historia.png");
    expect(publicDownloadName("Carrusel de lanzamiento", "zip", 1, 5)).toBe("carrusel-de-lanzamiento-imagenes.zip");
  });

  it("el encabezado no deja pasar comillas ni saltos de línea", () => {
    const header = attachmentHeader('a"b\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/filename="([^"]*)"/)?.[1]).toMatch(/^[a-z0-9-]+\.pdf$/);
    expect(attachmentHeader("certificado-ana-perez.pdf")).toBe(`attachment; filename="certificado-ana-perez.pdf"; filename*=UTF-8''certificado-ana-perez.pdf`);
  });

  it("el tipo de contenido de cada formato", () => {
    expect([contentTypeOf("pdf"), contentTypeOf("zip"), contentTypeOf("png")]).toEqual(["application/pdf", "application/zip", "image/png"]);
  });
});
