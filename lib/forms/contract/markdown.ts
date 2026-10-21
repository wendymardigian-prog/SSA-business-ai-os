/**
 * El Markdown ACOTADO del contrato (F24). PURO, y es el MISMO para la página
 * pública y para el PDF: lo que ve quien firma es lo que queda en el documento.
 *
 * Se entiende: títulos `#`, `##` y `###`, **negrita**, *cursiva* (o _cursiva_),
 * links `[texto](https://…)` (solo http, https, mailto y tel), listas (`- ` / `* `
 * y `1. `) y párrafos. Una barra invertida deja literal el carácter que sigue
 * (`\*` es un asterisco): así el editor con formato puede guardar cualquier texto.
 * Nada más: sin HTML ni imágenes. Todo lo demás queda como TEXTO literal. Un
 * `<script>` no se interpreta ni se ejecuta jamás: es una frase más del contrato
 * (React la escapa al dibujar y el PDF la escribe como texto).
 *
 * La pantalla no escribe este Markdown a mano: lo arma el editor con formato
 * (`editor-markdown.ts`), que es la ida y vuelta entre el editor y este texto.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Solo una dirección que pasó `safeHref`. */
  href?: string;
}

export type HeadingLevel = 1 | 2 | 3;

export type ContractBlock =
  | { type: "heading"; level: HeadingLevel; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: InlineRun[][] };

/** Los caracteres que una barra invertida deja literales. */
export const ESCAPABLE = new Set(["\\", "*", "_", "[", "]", "(", ")", "#", "-", "+", ".", "!", "{", "}"]);

/** Un link de contrato solo puede ir a una web, un email o un teléfono. Cualquier otra cosa (javascript:, data:) no es link. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 2000 || /\s/.test(value)) return null;
  if (/^https?:\/\/[^/\s]+/i.test(value)) return value;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return value;
  if (/^tel:\+?[\d\s().-]{4,}$/i.test(value)) return value;
  return null;
}

/** ¿El carácter en `index` está escapado con una barra invertida (una cantidad impar de barras antes)? */
function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** La primera aparición de `token` desde `from` que no está escapada; -1 si no hay. */
function findUnescaped(text: string, token: string, from: number): number {
  let index = text.indexOf(token, from);
  while (index !== -1 && isEscaped(text, index)) index = text.indexOf(token, index + 1);
  return index;
}

function unescapedCount(text: string, char: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === char && !isEscaped(text, i)) count++;
  return count;
}

type Marks = Omit<InlineRun, "text">;

function withText(text: string, marks: Marks): InlineRun {
  const run: InlineRun = { text };
  if (marks.bold) run.bold = true;
  if (marks.italic) run.italic = true;
  if (marks.href) run.href = marks.href;
  return run;
}

function parseInto(text: string, marks: Marks, runs: InlineRun[]): void {
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) runs.push(withText(buffer, marks));
    buffer = "";
  };

  while (i < text.length) {
    const char = text[i];

    if (char === "\\" && ESCAPABLE.has(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    // Un link: `[texto](dirección)`. Un `![…](…)` (imagen) queda literal, y un link adentro de otro también.
    if (char === "[" && text[i - 1] !== "!" && !marks.href) {
      const close = findUnescaped(text, "](", i + 1);
      const end = close === -1 ? -1 : findUnescaped(text, ")", close + 2);
      const label = close === -1 ? "" : text.slice(i + 1, close);
      const href = end === -1 ? null : safeHref(text.slice(close + 2, end));
      if (href && label.trim() && !label.includes("\n")) {
        flush();
        parseInto(label, { ...marks, href }, runs);
        i = end + 1;
        continue;
      }
    }

    if (text.slice(i, i + 2) === "**") {
      let end = findUnescaped(text, "**", i + 2);
      // `***x***` y `**a *b***`: si adentro quedó una cursiva abierta, el cierre de la negrita son los DOS ÚLTIMOS
      // asteriscos de la tanda. En `**b***a*` no: ahí el tercero abre la cursiva que sigue.
      if (end !== -1 && text[end + 2] === "*" && unescapedCount(text.slice(i + 2, end), "*") % 2 === 1) end += 1;
      if (end > i + 2) {
        flush();
        parseInto(text.slice(i + 2, end), { ...marks, bold: true }, runs);
        i = end + 2;
        continue;
      }
    }

    if ((char === "*" || char === "_") && text[i + 1] !== char && text[i + 1] !== " " && text[i + 1] !== undefined) {
      const end = findUnescaped(text, char, i + 1);
      // El guion bajo solo abre y cierra en el borde de una palabra: `nombre_apellido` no es cursiva.
      const wordEdge = char === "*" || (!/\w/.test(text[i - 1] ?? " ") && !/\w/.test(text[end + 1] ?? " "));
      // Pegado a otro igual no cierra (`**` es negrita), salvo una tanda de tres: `*a***b**` = cursiva y después negrita.
      const closes = text[end + 1] !== char || (char === "*" && text[end + 2] === "*" && text[end + 3] !== "*");
      if (end > i + 1 && wordEdge && text[end - 1] !== " " && closes) {
        flush();
        parseInto(text.slice(i + 1, end), { ...marks, italic: true }, runs);
        i = end + 1;
        continue;
      }
    }

    buffer += char;
    i++;
  }
  flush();
}

/** `**negrita**`, `*cursiva*`, `_cursiva_`, `[link](https://…)` y `\*` literales. Lo que no cierra queda literal. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  parseInto(text, {}, runs);
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
      const level = Math.min(heading[1].length, 3) as HeadingLevel;
      blocks.push({ type: "heading", level, runs: parseInline(heading[2].trim()) });
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
