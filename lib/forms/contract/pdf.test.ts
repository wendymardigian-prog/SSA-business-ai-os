import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { buildContractPdf, textWidth, toWinAnsi, PDF_LOGO_MAX, type ContractPdfInput } from "./pdf";
import { pdfLogoFromBytes } from "./pdf-logo";
import sharp from "sharp";
import { StandardFonts } from "pdf-lib";
import { pdfSkippedKeys } from "./config";
import { newField } from "../fields";
import { answerToText, orderedAnswers } from "../responses";

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

  it("un link sale en el texto y se puede tocar (anotación con su dirección); un título 3 también sale", async () => {
    const bytes = await buildContractPdf(base({ text: "### Contacto\n\nEscribinos a [nuestro soporte](mailto:soporte@x.com) o mirá [la web](https://x.com/terminos)." }));
    const { all } = await read(bytes);
    expect(all).toContain("Contacto");
    expect(all).toContain("nuestro soporte");
    const doc = await PDFDocument.load(bytes);
    const uris = doc.getPages().flatMap((page) => {
      const annots = page.node.Annots();
      if (!annots) return [];
      return annots.asArray().map((ref) => {
        const annot = doc.context.lookup(ref) as unknown as { get: (k: PDFName) => unknown };
        const action = doc.context.lookup(annot.get(PDFName.of("A")) as never) as unknown as { get: (k: PDFName) => { decodeText: () => string } };
        return action.get(PDFName.of("URI")).decodeText();
      });
    });
    // Una anotación por palabra del link.
    expect(uris.filter((u) => u === "mailto:soporte@x.com")).toHaveLength(2);
    expect(uris.filter((u) => u === "https://x.com/terminos")).toHaveLength(2);
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

describe("el firmante no se repite en la lista de respuestas (R10)", () => {
  const fields = [newField("short_text", "nombre", "Nombre completo"), newField("email", "email", "Email"), newField("short_text", "empresa", "Empresa")].map((f) =>
    f.type === "email" ? { ...f, required: true } : f,
  );
  const stored = {
    nombre: { label: "Nombre completo", type: "short_text", value: "Ana Pérez" },
    email: { label: "Email", type: "email", value: "ana@example.com" },
    empresa: { label: "Empresa", type: "short_text", value: "Acme" },
  };

  /** Arma las respuestas como lo hace `runContractPdf`. */
  const answersForPdf = () => {
    const skip = pdfSkippedKeys(fields, Object.fromEntries(Object.entries(stored).map(([key, a]) => [key, a.value])));
    return orderedAnswers(stored, fields.map((f) => f.key))
      .filter(([key]) => !skip.has(key))
      .map(([, answer]) => ({ label: answer.label, value: answerToText(answer.value) }));
  };

  it("se saltean el campo del nombre y el del email, y queda lo demás", () => {
    expect(answersForPdf()).toEqual([{ label: "Empresa", value: "Acme" }]);
  });

  it("el texto extraído del PDF trae el email del firmante UNA sola vez (y el nombre, una)", async () => {
    const { all } = await read(await buildContractPdf(base({ answers: answersForPdf() })));
    expect(all.split("ana@example.com")).toHaveLength(2);
    expect(all.split("Ana Pérez")).toHaveLength(2);
    expect(all).toContain("Acme");
  });

  it("antes del arreglo (con todas las respuestas) el email salía dos veces", async () => {
    const everything = orderedAnswers(stored, fields.map((f) => f.key)).map(([, a]) => ({ label: a.label, value: answerToText(a.value) }));
    const { all } = await read(await buildContractPdf(base({ answers: everything })));
    expect(all.split("ana@example.com").length).toBeGreaterThan(2);
  });
});

describe("modo Contrato: firmas abajo y certificado aparte", () => {
  const RENDERED = "d".repeat(64);
  const JPG_1X1 = Uint8Array.from(
    Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
      "base64",
    ),
  );

  it("las dos firmas con sus nombres, el certificado en otra página y la huella del documento al pie", async () => {
    const bytes = await buildContractPdf(
      base({
        text: "# Acuerdo\n\nEntre **Acme SA** y Mi Negocio, por 1500.00.",
        signaturePng: PNG_1X1,
        contract: { renderedSha256: RENDERED, businessSigner: { name: "Laura Méndez", role: "Directora", image: PNG_1X1 } },
      }),
    );
    const { pages, totalPages } = await read(bytes);
    expect(totalPages).toBe(2);
    expect(pages[0]).toContain("Acme SA");
    expect(pages[0]).toContain("Firmas");
    expect(pages[0]).toContain("Laura Méndez");
    expect(pages[0]).toContain("Directora");
    expect(pages[0]).toContain("Ana Pérez");
    expect(pages[1]).toContain("Certificado de firma");
    expect(pages[1]).toContain(RENDERED);
    expect(pages[1]).toContain(SHA);
    // Al pie de cada página, la huella del documento firmado (no la de la plantilla).
    expect(pages[0]).toContain(`SHA-256: ${RENDERED}`);
  });

  it("sin la firma del negocio, solo la de la persona; una firma del negocio en JPG también sirve", async () => {
    const solo = await read(await buildContractPdf(base({ signaturePng: PNG_1X1, contract: { renderedSha256: RENDERED, businessSigner: null } })));
    expect(solo.pages[0]).toContain("Ana Pérez");
    expect(solo.pages[0]).not.toContain("Por Mi Negocio");
    const jpg = await buildContractPdf(base({ contract: { renderedSha256: RENDERED, businessSigner: { name: "W", role: "", image: JPG_1X1 } } }));
    expect(Buffer.from(jpg.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("los espacios entre palabras (kerning)", () => {
  it("textWidth mide como se dibuja: letra por letra, sin el ajuste entre pares", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const drawn = [..."PARTICIPANTE"].reduce((sum, c) => sum + font.widthOfTextAtSize(c, 10), 0);
    expect(textWidth(font, "PARTICIPANTE", 10)).toBeCloseTo(drawn, 6);
    // pdf-lib la mide más angosta (descuenta «PA» dos veces): eso era lo que se comía el espacio.
    expect(font.widthOfTextAtSize("PARTICIPANTE", 10)).toBeLessThan(drawn - 2);
  });

  it("«EL PARTICIPANTE dependen» deja el espacio entre las dos palabras en la página", async () => {
    const bytes = await buildContractPdf(base({ text: "Los resultados de EL PARTICIPANTE dependen de su dedicación." }));
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const page = await pdf.getPage(1);
    const { OPS } = await import("unpdf/pdfjs");
    const ops = await page.getOperatorList();
    // Cada palabra se dibuja aparte: dónde empieza (setTextMatrix), en qué tamaño (setFont) y qué dice (showText).
    const drawn: Array<{ text: string; x: number; size: number }> = [];
    let x = 0;
    let size = 0;
    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.setFont) size = args[1] as number;
      if (fn === OPS.setTextMatrix) x = (args[0] as number[])[4] ?? (args[4] as number);
      if (fn === OPS.showText) {
        const text = (args[0] as Array<{ unicode?: string } | number>).map((g) => (typeof g === "object" && g ? g.unicode ?? "" : "")).join("");
        drawn.push({ text, x, size });
      }
    });
    const index = drawn.findIndex((d) => d.text === "PARTICIPANTE");
    expect(index, JSON.stringify(drawn.map((d) => d.text))).toBeGreaterThan(-1);
    const word = drawn[index];
    const next = drawn.slice(index + 1).find((d) => d.text === "dependen")!;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Entre el comienzo de «PARTICIPANTE» y el de «dependen» entran la palabra dibujada (sin kerning) y un espacio entero.
    const drawnWidth = [..."PARTICIPANTE "].reduce((sum, c) => sum + font.widthOfTextAtSize(c, word.size), 0);
    expect(next.x - word.x).toBeCloseTo(drawnWidth, 3);
  });
});

describe("buildContractPdf: renglones vacíos, párrafos y logo", () => {
  /** Las imágenes de la primera hoja (XObject). */
  const imagesOnFirstPage = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const resources = doc.getPages()[0].node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), (await import("pdf-lib")).PDFDict);
    return xobjects ? xobjects.keys().length : 0;
  };
  /** La altura (y) donde arranca cada línea de texto de la primera hoja. */
  const lineYs = async (bytes: Uint8Array, words: string[]) => {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    return words.map((w) => {
      const item = (content.items as Array<{ str: string; transform: number[] }>).find((i) => i.str.includes(w));
      return item ? item.transform[5] : NaN;
    });
  };

  it("un renglón vacío ocupa lugar: «B» queda más abajo que sin él", async () => {
    const [, bWithout] = await lineYs(await buildContractPdf(base({ text: "Alfa\n\nBravo" })), ["Alfa", "Bravo"]);
    const [, bWith] = await lineYs(await buildContractPdf(base({ text: "Alfa\n\n\n\nBravo" })), ["Alfa", "Bravo"]);
    expect(bWithout - bWith).toBeGreaterThan(12);
  });

  it("entre dos párrafos queda más aire que entre dos líneas del mismo párrafo", async () => {
    const [a1, b1] = await lineYs(await buildContractPdf(base({ text: "Alfa\nBravo" })), ["Alfa", "Bravo"]);
    const [a2, b2] = await lineYs(await buildContractPdf(base({ text: "Alfa\n\nBravo" })), ["Alfa", "Bravo"]);
    expect(a2 - b2 - (a1 - b1)).toBeGreaterThanOrEqual(8);
  });

  it("con logo lleva una imagen arriba de la primera hoja; sin logo, ninguna", async () => {
    const png = await sharp({ create: { width: 400, height: 100, channels: 4, background: "#1d4ed8" } }).png().toBuffer();
    const logo = await pdfLogoFromBytes(new Uint8Array(png));
    expect(logo).not.toBeNull();
    expect(await imagesOnFirstPage(await buildContractPdf(base({ logo })))).toBe(1);
    expect(await imagesOnFirstPage(await buildContractPdf(base()))).toBe(0);
    expect(PDF_LOGO_MAX.height).toBeLessThanOrEqual(40);
  });

  it("un logo WebP se convierte a PNG", async () => {
    const webp = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#000" } }).webp().toBuffer();
    const logo = await pdfLogoFromBytes(new Uint8Array(webp));
    expect(logo?.png.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("un logo roto no rompe el PDF: sale sin logo", async () => {
    expect(await pdfLogoFromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
    const bytes = await buildContractPdf(base({ logo: { png: new Uint8Array([1, 2, 3]), width: 10, height: 10 } }));
    const { all } = await read(bytes);
    expect(all).toContain("Acuerdo de servicios");
    expect(await imagesOnFirstPage(bytes)).toBe(0);
  });
});
