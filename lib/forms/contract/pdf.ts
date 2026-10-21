/**
 * El PDF firmado de un contrato (F27). SOLO servidor: usa `pdf-lib` (JS puro,
 * sin binarios) y nunca se importa desde un Client Component.
 *
 * Sale del texto de la VERSIÓN con la que se firmó (el mismo `renderContractMarkdown`
 * que ve la persona en la página) más los datos del firmante, sus respuestas, la
 * firma dibujada y el bloque "Datos de aceptación". Al pie de CADA página va la
 * huella SHA-256 y la versión: ese es el vínculo entre el papel y lo que se firmó.
 *
 * Fuentes estándar (Helvetica) con codificación WinAnsi, que cubre el español
 * (á é í ó ú ñ ü ¿ ¡). Lo que no entra (un emoji, por ejemplo) se reemplaza por `?`
 * con `toWinAnsi` (`pdf-charset.ts`): la generación nunca se rompe por un carácter raro.
 * Los links del texto salen subrayados y se pueden tocar (una anotación por palabra).
 */
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { renderContractMarkdown, type InlineRun } from "./markdown";
import { toWinAnsi } from "./pdf-charset";

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 64, bottom: 64 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const GRAY = rgb(0.4, 0.4, 0.4);
const BLACK = rgb(0.1, 0.1, 0.1);
const LINK = rgb(0.1, 0.3, 0.75);

export { toWinAnsi };

export interface ContractPdfInput {
  businessName: string;
  title: string;
  /** El texto normalizado de la versión firmada. */
  text: string;
  versionNumber: number;
  /** La huella SHA-256 (64 hex) del texto. */
  sha256: string;
  signer: { name: string; email: string };
  /** Etiqueta → valor, ya en texto. */
  answers: Array<{ label: string; value: string }>;
  signaturePng: Uint8Array | null;
  signedAt: Date;
  /** La zona del workspace, para mostrar la hora local además de UTC. */
  timeZone: string;
  legal: {
    ip?: string | null;
    device?: string | null;
    os?: string | null;
    browser?: string | null;
    timezone?: string | null;
    locale?: string | null;
    acceptedLabel?: string | null;
  };
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN.top;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  fontFor(run: InlineRun): PDFFont {
    if (run.bold && run.italic) return this.fonts.boldItalic;
    if (run.bold) return this.fonts.bold;
    if (run.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Escribe unos tramos con salto de línea automático. Devuelve cuando termina. */
  runs(runs: InlineRun[], size: number, options: { indent?: number; color?: ReturnType<typeof rgb>; lineGap?: number } = {}) {
    const indent = options.indent ?? 0;
    const lineHeight = size * (1.25 + (options.lineGap ?? 0));
    const maxWidth = CONTENT_WIDTH - indent;

    // Cada palabra con su fuente, respetando los saltos de línea del texto.
    type Word = { text: string; font: PDFFont; newline?: boolean; href?: string };
    const words: Word[] = [];
    for (const run of runs) {
      const font = this.fontFor(run);
      const lines = toWinAnsi(run.text).split("\n");
      lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) words.push({ text: "", font, newline: true });
        for (const part of line.split(/(\s+)/)) {
          if (part !== "") words.push({ text: part, font, ...(run.href ? { href: run.href } : {}) });
        }
      });
    }

    let line: Word[] = [];
    let width = 0;
    const flush = () => {
      this.ensure(lineHeight);
      let x = MARGIN.left + indent;
      for (const word of line) {
        if (!word.text) continue;
        const wordWidth = word.font.widthOfTextAtSize(word.text, size);
        this.page.drawText(word.text, { x, y: this.y - size, size, font: word.font, color: word.href ? LINK : (options.color ?? BLACK) });
        if (word.href && !/^\s+$/.test(word.text)) this.link(x, this.y - size, wordWidth, size, word.href);
        x += wordWidth;
      }
      this.y -= lineHeight;
      line = [];
      width = 0;
    };

    for (const word of words) {
      if (word.newline) {
        flush();
        continue;
      }
      const w = word.font.widthOfTextAtSize(word.text, size);
      const isSpace = /^\s+$/.test(word.text);
      if (!isSpace && width + w > maxWidth && line.length > 0) {
        // Se corta antes de la palabra; el espacio que quedó al final no se escribe.
        while (line.length > 0 && /^\s+$/.test(line[line.length - 1].text)) line.pop();
        flush();
      }
      if (isSpace && line.length === 0) continue; // sin espacios al inicio de línea
      // Una palabra más ancha que la línea (un hash, una URL) se parte por caracteres.
      if (!isSpace && w > maxWidth) {
        for (const chunk of splitToWidth(word.text, word.font, size, maxWidth)) {
          if (line.length > 0) flush();
          line.push({ text: chunk, font: word.font, ...(word.href ? { href: word.href } : {}) });
          width = word.font.widthOfTextAtSize(chunk, size);
        }
        continue;
      }
      line.push(word);
      width += w;
    }
    if (line.length > 0) flush();
  }

  /** Subraya una palabra de un link y la hace clicable (anotación URI). */
  link(x: number, baseline: number, width: number, size: number, href: string) {
    this.page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + width, y: baseline - 1.5 }, thickness: 0.5, color: LINK });
    const annotation = this.doc.context.register(
      this.doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, baseline - 3, x + width, baseline + size],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
      }),
    );
    this.page.node.addAnnot(annotation);
  }

  space(points: number) {
    this.y -= points;
    if (this.y < MARGIN.bottom) this.newPage();
  }

  text(text: string, size: number, font: PDFFont, options: { color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    this.runs([{ text, bold: font === this.fonts.bold, italic: font === this.fonts.italic }], size, options);
  }
}

function splitToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of text) {
    if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const HEADING_SIZE = { 1: 15, 2: 12.5, 3: 11 } as const;

const dateTime = (date: Date, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("es", { timeZone, dateStyle: "long", timeStyle: "medium" }).format(date);
  } catch {
    return date.toISOString();
  }
};

export async function buildContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(input.title).slice(0, 200));
  doc.setProducer("pdf-lib");
  doc.setCreationDate(input.signedAt);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const w = new Writer(doc, fonts);

  // Encabezado: el negocio y el título.
  w.text(input.businessName, 9, fonts.bold, { color: GRAY });
  w.space(6);
  w.runs([{ text: input.title, bold: true }], 20);
  w.space(10);

  // El texto del contrato, con el mismo renderizador que la página.
  for (const block of renderContractMarkdown(input.text)) {
    if (block.type === "heading") {
      w.space(block.level === 1 ? 8 : block.level === 2 ? 5 : 4);
      w.runs(block.runs.map((r) => ({ ...r, bold: true })), HEADING_SIZE[block.level]);
      w.space(3);
    } else if (block.type === "paragraph") {
      w.runs(block.runs, 10.5);
      w.space(5);
    } else {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${index + 1}.` : "•";
        w.ensure(14);
        const yBefore = w.y;
        const pageBefore = w.page;
        w.runs(item, 10.5, { indent: 16 });
        // El marcador se dibuja en la primera línea del ítem (si el salto de página lo movió, en la página nueva).
        const target = w.page === pageBefore ? pageBefore : w.page;
        const markerY = w.page === pageBefore ? yBefore - 10.5 : PAGE.height - MARGIN.top - 10.5;
        target.drawText(toWinAnsi(marker), { x: MARGIN.left + 2, y: markerY, size: 10.5, font: fonts.regular, color: BLACK });
        w.space(2);
      });
      w.space(4);
    }
  }

  // El firmante y lo que respondió.
  w.space(10);
  w.ensure(60);
  w.runs([{ text: "Firmante", bold: true }], 13);
  w.space(3);
  w.runs([{ text: "Nombre: ", bold: true }, { text: input.signer.name || "-" }], 10.5);
  w.runs([{ text: "Email: ", bold: true }, { text: input.signer.email || "-" }], 10.5);
  for (const answer of input.answers) {
    w.runs([{ text: `${answer.label}: `, bold: true }, { text: answer.value || "-" }], 10.5);
  }

  // La firma dibujada.
  w.space(10);
  if (input.signaturePng) {
    const image = await doc.embedPng(input.signaturePng);
    const maxWidth = 220;
    const scale = Math.min(1, maxWidth / image.width);
    const width = image.width * scale;
    const height = image.height * scale;
    w.ensure(height + 22);
    w.runs([{ text: "Firma", bold: true }], 11);
    w.space(2);
    w.page.drawImage(image, { x: MARGIN.left, y: w.y - height, width, height });
    w.page.drawRectangle({ x: MARGIN.left, y: w.y - height, width, height, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
    w.y -= height + 8;
  } else {
    w.runs([{ text: "Firma: ", bold: true }, { text: "sin firma dibujada (no era obligatoria)", italic: true }], 10.5);
  }

  // Datos de aceptación: lo que sirve de evidencia.
  w.space(12);
  w.ensure(110);
  w.runs([{ text: "Datos de aceptación", bold: true }], 13);
  w.space(3);
  const rows: Array<[string, string]> = [
    ["Fecha y hora (servidor)", `${dateTime(input.signedAt, input.timeZone)} (${input.timeZone})`],
    ["Fecha y hora (UTC)", input.signedAt.toISOString()],
    ["Dirección IP", input.legal.ip || "-"],
    ["Dispositivo", input.legal.device || "-"],
    ["Sistema operativo", input.legal.os || "-"],
    ["Navegador", input.legal.browser || "-"],
    ["Zona horaria declarada por el navegador", input.legal.timezone || "-"],
    ["Idioma declarado por el navegador", input.legal.locale || "-"],
    ["Casilla de aceptación", input.legal.acceptedLabel || "-"],
    ["Versión del texto", `Versión ${input.versionNumber}`],
    ["Huella SHA-256 del texto", input.sha256],
  ];
  for (const [label, value] of rows) w.runs([{ text: `${label}: `, bold: true }, { text: value }], 9.5);

  // Pie de cada página: la huella y la versión.
  const total = w.pages.length;
  w.pages.forEach((page, index) => {
    const footer = toWinAnsi(`Versión ${input.versionNumber}  |  SHA-256: ${input.sha256}`);
    page.drawLine({ start: { x: MARGIN.left, y: 44 }, end: { x: PAGE.width - MARGIN.right, y: 44 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
    page.drawText(footer, { x: MARGIN.left, y: 30, size: 6.5, font: fonts.regular, color: GRAY });
    const label = `${index + 1} de ${total}`;
    page.drawText(label, { x: PAGE.width - MARGIN.right - fonts.regular.widthOfTextAtSize(label, 8), y: 30, size: 8, font: fonts.regular, color: GRAY });
  });

  return doc.save();
}
