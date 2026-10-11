import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { buildContractPdf, toWinAnsi, type ContractPdfInput } from "./pdf";

const SHA = "a".repeat(8) + "0123456789abcdef".repeat(3) + "b".repeat(8);

const base = (over: Partial<ContractPdfInput> = {}): ContractPdfInput => ({
  businessName: "Mi Negocio",
  title: "Acuerdo de servicios",
  text: "# Acuerdo\n\nEste contrato se firma con **buena fe**.\n\n- Primera cláusula\n- Segunda cláusula",
  versionNumber: 1,
  sha256: SHA,
  signer: { name: "Ana Pérez", email: "ana@example.com" },
  answers: [{ label: "Empresa", value: "Acme" }],
  signaturePng: null,
  signedAt: new Date("2026-10-11T12:00:00Z"),
  timeZone: "America/Costa_Rica",
  legal: { ip: "203.0.113.9", device: "mobile", os: "iOS", browser: "Safari", timezone: "America/Costa_Rica", locale: "es-CR", acceptedLabel: "Leí y acepto" },
  ...over,
});

async function read(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text as string[], all: (text as string[]).join("\n") };
}

// Un PNG de 1x1 válido, para la firma.
const PNG_1X1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));

describe("toWinAnsi", () => {
  it("deja pasar el español", () => {
    expect(toWinAnsi("áéíóú ñ ü ¿? ¡!")).toBe("áéíóú ñ ü ¿? ¡!");
  });
  it("reemplaza lo que no entra (un emoji) por ?", () => {
    expect(toWinAnsi("Hola 😀 mundo")).toBe("Hola ? mundo");
    expect(toWinAnsi("日本")).toBe("??");
  });
  it("deja los símbolos de Windows-1252 y quita controles", () => {
    expect(toWinAnsi("5 € “hola”")).toBe("5 € “hola”");
    expect(toWinAnsi("a\u0000b\tc")).toBe("a b    c");
  });
});

describe("buildContractPdf", () => {
  it("contiene el título, el firmante, la huella y 'Versión 1'", async () => {
    const { all } = await read(await buildContractPdf(base()));
    expect(all).toContain("Acuerdo de servicios");
    expect(all).toContain("Ana Pérez");
    expect(all).toContain("ana@example.com");
    expect(all).toContain(SHA);
    expect(all).toContain("Versión 1");
    expect(all).toContain("Primera cláusula");
    expect(all).toContain("Acme");
  });

  it("la ñ y el ¿ aparecen en el texto extraído; un emoji no rompe la generación", async () => {
    const bytes = await buildContractPdf(base({ text: "Cláusula única: ¿España? Mañana 😀 se firma." }));
    const { all } = await read(bytes);
    expect(all).toContain("¿España?");
    expect(all).toContain("Mañana");
    expect(all).toContain("se firma");
  });

  it("un texto de tres páginas tiene la huella al pie de cada una", async () => {
    const paragraph = "Esta cláusula describe las obligaciones de las partes con bastante detalle para ocupar espacio. ".repeat(6);
    const text = Array.from({ length: 40 }, (_, i) => `## Cláusula ${i + 1}\n\n${paragraph}`).join("\n\n");
    const { totalPages, pages } = await read(await buildContractPdf(base({ text })));
    expect(totalPages).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      expect(page).toContain(SHA);
      expect(page).toContain("Versión 1");
    }
    expect(pages[pages.length - 1]).toContain(`${totalPages} de ${totalPages}`);
  });

  it("incluye los datos de aceptación y la zona declarada rotulada como tal", async () => {
    const { all } = await read(await buildContractPdf(base()));
    expect(all).toContain("Datos de aceptación");
    expect(all).toContain("203.0.113.9");
    expect(all).toContain("2026-10-11T12:00:00.000Z");
    expect(all).toContain("declarada por el navegador");
    expect(all).toContain("Safari");
  });

  it("con una firma dibujada la incrusta; sin ella lo dice", async () => {
    const countImages = async (bytes: Uint8Array) => {
      const doc = await PDFDocument.load(bytes);
      let n = 0;
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) n++;
      }
      return n;
    };
    const withSig = await buildContractPdf(base({ signaturePng: PNG_1X1 }));
    const withoutSig = await buildContractPdf(base({ signaturePng: null }));
    expect(await countImages(withSig)).toBe(1);
    expect(await countImages(withoutSig)).toBe(0);
    expect((await read(withSig)).all).not.toContain("sin firma dibujada");
    expect((await read(withoutSig)).all).toContain("sin firma dibujada");
  });

  it("una palabra más ancha que la línea (un hash) no se sale de la página ni rompe", async () => {
    const { all } = await read(await buildContractPdf(base({ text: `Código: ${"x".repeat(400)}` })));
    expect(all).toContain("xxxx");
  });

  it("el PDF empieza con la cabecera de PDF", async () => {
    const bytes = await buildContractPdf(base());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
