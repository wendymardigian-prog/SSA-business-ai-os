/**
 * El Markdown ACOTADO del contrato (F24). PURO, y es el MISMO para la página
 * pública y para el PDF: lo que ve quien firma es lo que queda en el documento.
 *
 * Se entiende: títulos `#` y `##`, **negrita**, *cursiva* (o _cursiva_), listas
 * (`- ` / `* ` y `1. `) y párrafos. Nada más: sin HTML, sin links, sin imágenes.
 * Todo lo demás queda como TEXTO literal. Un `<script>` no se interpreta ni se
 * ejecuta jamás: es una frase más del contrato (React la escapa al dibujar y el
 * PDF la escribe como texto).
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type ContractBlock =
  | { type: "heading"; level: 1 | 2; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: InlineRun[][] };

/** `**negrita**`, `*cursiva*` y `_cursiva_`. Lo que no cierra queda literal. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) runs.push({ text: buffer });
    buffer = "";
  };

  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "**") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        runs.push({ text: text.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }
    const char = text[i];
    if ((char === "*" || char === "_") && text[i + 1] !== char && text[i + 1] !== " " && text[i + 1] !== undefined) {
      const end = text.indexOf(char, i + 1);
      // El guion bajo solo abre y cierra en el borde de una palabra: `nombre_apellido` no es cursiva.
      const wordEdge = char === "*" || (!/\w/.test(text[i - 1] ?? " ") && !/\w/.test(text[end + 1] ?? " "));
      if (end > i + 1 && wordEdge && text[end - 1] !== " " && text[end + 1] !== char) {
        flush();
        runs.push({ text: text.slice(i + 1, end), italic: true });
        i = end + 1;
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
  return runs;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

export function renderContractMarkdown(text: string): ContractBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ContractBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", runs: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length === 1 ? 1 : 2, runs: parseInline(heading[2].trim()) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** El texto plano de un bloque (para el PDF y para buscar). */
export function plainText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}
