/**
 * Los RENGLONES VACÍOS del Markdown acotado (18/11/2026), PURO. Lo usan el contrato (la página que se firma, el PDF y
 * el editor) y la comunidad del portal, que lee el mismo Markdown.
 *
 * Entre dos bloques, cada par de saltos de línea DE MÁS es un renglón vacío: `a\n\n\n\nb` = «a», un renglón vacío,
 * «b». Con dos o tres saltos, como siempre: dos párrafos seguidos. Un renglón vacío es un párrafo sin texto
 * (`runs: []`); quien dibuja le da el alto de una línea. Los del principio y el final no cuentan.
 *
 * El texto que se firma (y su huella) no cambia: esto solo decide cómo se LEE lo guardado.
 */
import { renderContractMarkdown, type ContractBlock } from "./markdown";
import { editorDocToMarkdown, markdownToEditorDoc, type DocNode } from "./editor-markdown";

/** Un tramo de texto o un renglón vacío. */
export type BlankLinePiece = { text: string } | { blank: true };

/** Corta el texto donde hay cuatro o más saltos de línea seguidos: cada par de más es un renglón vacío. */
export function splitBlankLines(body: string): BlankLinePiece[] {
  const text = (body ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  const out: BlankLinePiece[] = [];
  let last = 0;
  for (const m of text.matchAll(/\n{4,}/g)) {
    const at = m.index ?? 0;
    out.push({ text: text.slice(last, at) });
    for (let i = 0; i < Math.floor((m[0].length - 2) / 2); i++) out.push({ blank: true });
    last = at + m[0].length;
  }
  out.push({ text: text.slice(last) });
  return out;
}

/** Los bloques para dibujar (página, PDF): el Markdown de siempre, con un párrafo sin texto por cada renglón vacío. */
export function blocksWithBlankLines(body: string): ContractBlock[] {
  return splitBlankLines(body).flatMap((piece): ContractBlock[] =>
    "blank" in piece ? [{ type: "paragraph", runs: [] }] : renderContractMarkdown(piece.text),
  );
}

/** ¿Un párrafo del editor sin nada escrito? (vacío, solo espacios o solo un Shift+Enter) */
export function isEmptyEditorParagraph(node: DocNode): boolean {
  return node.type === "paragraph" && !(node.content ?? []).some((c) => c.type !== "hardBreak" && !(c.type === "text" && !c.text?.trim()));
}

/** Lo guardado → el documento del editor (un renglón vacío vuelve a ser un párrafo vacío). */
export function markdownToEditorDocWithBlankLines(body: string): DocNode {
  const content: DocNode[] = [];
  for (const piece of splitBlankLines(body)) {
    if ("blank" in piece) content.push({ type: "paragraph" });
    else if (piece.text.trim()) content.push(...(markdownToEditorDoc(piece.text).content ?? []).filter((n) => !isEmptyEditorParagraph(n)));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * El documento del editor → lo que se guarda. Un párrafo vacío ENTRE dos bloques con texto es un renglón vacío (se
 * guarda como dos saltos de línea de más); los vacíos del principio y el final se descartan.
 */
export function editorDocToMarkdownWithBlankLines(doc: DocNode): string {
  const parts: string[] = [];
  for (const node of doc.content ?? []) {
    const md = editorDocToMarkdown({ type: "doc", content: [node] });
    if (md.trim()) parts.push(md);
    else if (isEmptyEditorParagraph(node)) parts.push("");
  }
  while (parts.length && parts[0] === "") parts.shift();
  while (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts.join("\n\n").trim();
}

/**
 * Un texto pegado que ya viene en Markdown (de Claude, de ChatGPT, de Notion como texto) se abre con su formato.
 */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,3}\s|[-*]\s|\d+[.)]\s)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((https?:|mailto:|tel:)/.test(text);
}

/**
 * Un texto plano pegado (sin formato) → el documento del editor: cada línea es un párrafo y cada línea vacía, un
 * renglón vacío. El texto entra literal (nada se interpreta como Markdown). Las puntas vacías se descartan.
 */
export function plainTextToEditorDoc(text: string): DocNode {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const content: DocNode[] = lines.map((line) => (line.trim() ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Lo que el editor del contrato hace con un texto pegado sin HTML: Markdown con su formato, o texto con sus renglones. */
export function contractPasteText(text: string): DocNode | null {
  if (!text?.trim()) return null;
  return looksLikeMarkdown(text) ? markdownToEditorDocWithBlankLines(text) : plainTextToEditorDoc(text);
}
