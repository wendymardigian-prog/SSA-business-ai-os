/**
 * De archivo subido a markdown (F16).
 *
 * Dos responsabilidades: decir que ES el archivo de verdad, y convertirlo.
 *
 * Por que no se confia en la extension ni en el Content-Type que manda el
 * navegador: los dos los elige quien sube. Un .exe renombrado a .pdf llega con
 * extension .pdf y con el Content-Type que el cliente quiera declarar. Lo unico
 * que no se puede falsear sin cambiar el archivo son sus primeros bytes.
 *
 * Los mensajes de error nunca incluyen el contenido del documento.
 */

export const MAX_FILE_BYTES = 26_214_400; // 25 MB

export const SUPPORTED_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type SupportedMime = (typeof SUPPORTED_MIMES)[number];

export const MIME_LABELS: Record<SupportedMime, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (DOCX)",
  "text/plain": "Texto",
  "text/markdown": "Markdown",
};

export type DetectionResult =
  | { ok: true; mime: SupportedMime }
  | { ok: false; error: string };

/** Los primeros bytes coinciden con esta firma? */
function startsWith(buffer: Uint8Array, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — DOCX es un ZIP

/**
 * Es texto legible en UTF-8?
 *
 * Un byte nulo descarta de entrada cualquier binario; despues se decodifica en
 * modo estricto, que falla ante cualquier secuencia UTF-8 invalida.
 */
function isUtf8Text(buffer: Uint8Array): boolean {
  // Un .docx o un .pdf tienen bytes nulos; un .txt real, no.
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/** La extension del archivo, en minuscula y sin punto. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Que es este archivo, mirando el contenido.
 *
 * La extension solo desempata entre .txt y .md, que son el mismo formato para
 * cualquier detector (los dos son texto plano) y solo se diferencian en como se
 * los lee despues. Para todo lo demas manda el contenido.
 */
export function detectMimeType(buffer: Uint8Array, filename: string): DetectionResult {
  if (buffer.length === 0) {
    return { ok: false, error: "El archivo esta vacio." };
  }

  if (startsWith(buffer, PDF_SIGNATURE)) {
    return { ok: true, mime: "application/pdf" };
  }

  if (startsWith(buffer, ZIP_SIGNATURE)) {
    // Un .docx es un ZIP, pero no todo ZIP es un .docx. Que sea un DOCX de
    // verdad lo termina de decidir mammoth al abrirlo: si no lo es, falla.
    const ext = extensionOf(filename);
    if (ext === "docx") {
      return {
        ok: true,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }
    return {
      ok: false,
      error:
        "El archivo es un comprimido (ZIP). Si es un documento de Word, guardalo como .docx y volve a subirlo.",
    };
  }

  if (isUtf8Text(buffer)) {
    const ext = extensionOf(filename);
    return { ok: true, mime: ext === "md" || ext === "markdown" ? "text/markdown" : "text/plain" };
  }

  return {
    ok: false,
    error:
      "No se reconoce el tipo de archivo. Se aceptan PDF, Word (.docx), texto (.txt) y Markdown (.md).",
  };
}

export type ExtractionResult =
  | { ok: true; markdown: string }
  | { ok: false; error: string };

/**
 * Convierte el archivo a markdown.
 *
 * Nunca lanza: un documento raro tiene que dejar ese documento en error, no
 * tumbar el job que lo procesa.
 */
export async function extractMarkdown(
  buffer: Uint8Array,
  mime: SupportedMime,
): Promise<ExtractionResult> {
  try {
    switch (mime) {
      case "application/pdf":
        return await extractFromPdf(buffer);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return await extractFromDocx(buffer);
      case "text/plain":
      case "text/markdown":
        return extractFromText(buffer);
    }
  } catch (err) {
    // El mensaje de la libreria puede traer un fragmento del documento, asi que
    // no se propaga: solo el tipo de error.
    console.error("[kb] fallo la conversion a markdown:", err instanceof Error ? err.name : "error");
    return {
      ok: false,
      error: "No se pudo leer el archivo. Puede estar danado o protegido con contrasena.",
    };
  }
}

async function extractFromPdf(buffer: Uint8Array): Promise<ExtractionResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];
  // Una linea de separacion por pagina: le da al chunker un corte natural y
  // deja rastro de donde estaba cada cosa.
  const markdown = pages
    .map((page, i) => `${pages.length > 1 ? `\n\n---\n\n<!-- pagina ${i + 1} -->\n\n` : ""}${page}`)
    .join("")
    .trim();

  if (!markdown) {
    return {
      ok: false,
      error:
        "El PDF no tiene texto seleccionable. Si es un documento escaneado, hay que pasarlo por un OCR antes de subirlo.",
    };
  }

  return { ok: true, markdown: normalize(markdown) };
}

/**
 * Salida de markdown de mammoth.
 *
 * Existe en runtime pero no esta en los tipos, porque mammoth la marca como
 * deprecada. Se usa igual —conserva titulos y listas, que es lo que le da
 * estructura a los chunks— pero con un fallback a extractRawText, que si esta
 * soportada, por si una version futura la saca del todo. Asi el dia que
 * desaparezca se pierde el formato, no la capacidad de indexar Word.
 */
type MammothWithMarkdown = {
  convertToMarkdown?: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
};

async function extractFromDocx(buffer: Uint8Array): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const input = { buffer: Buffer.from(buffer) };

  const withMarkdown = mammoth as unknown as MammothWithMarkdown;

  let value: string;
  if (typeof withMarkdown.convertToMarkdown === "function") {
    const result = await withMarkdown.convertToMarkdown(input);
    value = result.value ?? "";
  } else {
    const result = await mammoth.extractRawText(input);
    value = result.value ?? "";
  }

  const markdown = normalize(unescapeMarkdown(value));

  if (!markdown) {
    return { ok: false, error: "El documento de Word no tiene texto." };
  }

  return { ok: true, markdown };
}

/**
 * Saca los escapes que mammoth agrega de mas.
 *
 * mammoth escapa la puntuacion para que el markdown sea inequivoco, asi que un
 * "30 dias." sale como "30 dias\.". Es markdown correcto, pero lo que se indexa
 * y lo que se lee en pantalla es el texto, no el markdown renderizado: esas
 * barras son ruido en el embedding y quedan feas al leerlas.
 *
 * Solo se tocan las barras que preceden a puntuacion ASCII —que es exactamente
 * lo que mammoth escapa—; una barra en cualquier otro contexto se deja como
 * esta.
 */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1");
}

function extractFromText(buffer: Uint8Array): ExtractionResult {
  const text = normalize(new TextDecoder("utf-8").decode(buffer));

  if (!text) {
    return { ok: false, error: "El archivo no tiene texto." };
  }

  return { ok: true, markdown: text };
}

/**
 * Normaliza saltos de linea y espacios.
 *
 * Los extractores de PDF sueltan mucho espacio de relleno y lineas en blanco de
 * mas. Sin esto, el chunker cuenta ese ruido como contenido y los fragmentos
 * quedan mas chicos de lo que deberian.
 */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
