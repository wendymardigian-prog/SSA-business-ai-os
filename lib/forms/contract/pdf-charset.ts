/**
 * Qué caracteres puede escribir el PDF del contrato. PURO y sin `pdf-lib`: lo usa también el editor (navegador)
 * para avisar ANTES de publicar que un emoji no va a salir en el PDF.
 *
 * El PDF usa las fuentes estándar (Helvetica) con codificación WinAnsi: cubre el español (á é í ó ú ñ ü ¿ ¡) y
 * poco más. Lo que no entra se reemplaza por `?` (`toWinAnsi`): la generación nunca se rompe por un carácter raro.
 */

/** Los caracteres que WinAnsi sabe escribir: Latin-1 más unos pocos símbolos de Windows-1252. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function writable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= 255 || WIN_ANSI_EXTRA.has(char);
}

/** Reemplaza por `?` lo que WinAnsi no puede escribir (y quita saltos y controles que romperían `drawText`). */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\n" || char === "\t") out += char === "\t" ? "    " : "\n";
    else if (code < 32 || code === 127) out += " ";
    else if (writable(char)) out += char;
    else out += "?";
  }
  return out;
}

/** Los caracteres distintos del texto que el PDF NO puede escribir (emojis, otros alfabetos), en orden de aparición. */
export function unsupportedPdfChars(text: string): string[] {
  const seen = new Set<string>();
  // Por "grafema" (un emoji con tono de piel o una bandera son un solo símbolo para la persona).
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  for (const g of graphemes) {
    if (g === "\n" || g === "\t" || g === "\r\n") continue;
    if (Array.from(g).some((c) => !writable(c) && (c.codePointAt(0) ?? 0) >= 32)) seen.add(g);
  }
  return [...seen];
}
