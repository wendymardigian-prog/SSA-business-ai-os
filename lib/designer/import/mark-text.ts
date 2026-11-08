/**
 * Editar lo cargado (F42): los textos del HTML cargado se marcan con `data-tx="<id>"` al importar,
 * así el lienzo puede editar UNO sin tocar el resto, y una plantilla puede poner variables adentro.
 *
 * Marcar = cada elemento que solo tiene texto recibe el atributo; el texto suelto que convive con
 * otros elementos (`Hola <b>mundo</b>`) se envuelve en un `<span data-tx>` (no cambia cómo se ve).
 * Un elemento marcado es una unidad: no se marca nada adentro.
 *
 * Este archivo es PURO y liviano (se puede importar desde el navegador). Lo que se vuelve a guardar
 * pasa siempre por la limpieza en el servidor: ver `edit.ts` (`setNodeText`, `sanitizeDocHtml`).
 */

import { buildTree, decodeEntities, nodeAttr, textToHtml, tokenizeHtml, type HtmlNode, type HtmlTree } from "./html-scan";

/** Tope de textos marcados por documento: más allá, el resto no se marca (sigue viéndose igual). */
export const MAX_MARKED_TEXTS = 3000;

const TX_ATTR = "data-tx";
const NO_TEXT_INSIDE = new Set(["script", "style", "svg", "textarea", "select", "option", "title", "head", "noscript", "template", "iframe"]);
const NO_LOOSE_TEXT_IN = new Set(["table", "tbody", "thead", "tfoot", "tr", "colgroup", "ul", "ol", "dl"]);

const isBlank = (raw: string): boolean => /^(?:\s|&nbsp;|&#160;|&#xa0;)*$/i.test(raw);

function hasMark(node: HtmlNode): boolean {
  return nodeAttr(node, TX_ATTR) !== undefined;
}

function ancestorsSkip(node: HtmlNode): boolean {
  for (let p: HtmlNode | null = node.parent; p; p = p.parent) {
    if (NO_TEXT_INSIDE.has(p.name) || hasMark(p)) return true;
  }
  return false;
}

function nextFreeNumber(tree: HtmlTree): number {
  let max = 0;
  for (const node of tree.nodes) {
    const m = /^tx(\d+)$/.exec(nodeAttr(node, TX_ATTR) ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** Marca los textos editables que todavía no tienen marca. Marcar dos veces da lo mismo que una. */
export function markEditableText(html: string): { html: string; count: number } {
  const tree = buildTree(tokenizeHtml(html));
  let counter = nextFreeNumber(tree);
  let total = tree.nodes.filter(hasMark).length;
  const edits: { start: number; end: number; make: (id: string) => string }[] = [];

  for (const node of tree.nodes) {
    if (NO_TEXT_INSIDE.has(node.name) || ancestorsSkip(node) || hasMark(node)) continue;
    const texts = node.textTokens.filter((i) => !isBlank(tree.tokens[i].raw));
    if (texts.length === 0) continue;
    if (node.children.length === 0) {
      const open = tree.tokens[node.open];
      edits.push({ start: open.end - 1, end: open.end - 1, make: (id) => ` ${TX_ATTR}="${id}"` });
      continue;
    }
    if (NO_LOOSE_TEXT_IN.has(node.name)) continue;
    for (const index of texts) {
      const token = tree.tokens[index];
      edits.push({ start: token.start, end: token.end, make: (id) => `<span ${TX_ATTR}="${id}">${token.raw}</span>` });
    }
  }
  for (const index of tree.rootText) {
    const token = tree.tokens[index];
    if (isBlank(token.raw)) continue;
    edits.push({ start: token.start, end: token.end, make: (id) => `<span ${TX_ATTR}="${id}">${token.raw}</span>` });
  }

  // Los ids siguen el orden del documento; pasado el tope, el resto no se marca.
  const ordered = edits.sort((a, b) => a.start - b.start).slice(0, Math.max(0, MAX_MARKED_TEXTS - total));
  const inserts = ordered.map((edit) => ({ ...edit, insert: edit.make(`tx${counter++}`) }));
  total += inserts.length;

  let out = html;
  for (const edit of [...inserts].reverse()) out = out.slice(0, edit.start) + edit.insert + out.slice(edit.end);
  return { html: out, count: inserts.length };
}

export interface EditableText {
  id: string;
  text: string;
}

/** Los textos marcados, en orden, con su contenido en texto plano. */
export function listEditableTexts(html: string): EditableText[] {
  const tree = buildTree(tokenizeHtml(html));
  const out: EditableText[] = [];
  for (const node of tree.nodes) {
    const id = nodeAttr(node, TX_ATTR);
    if (!id) continue;
    const text = textOf(tree, node);
    out.push({ id, text });
  }
  return out;
}

function textOf(tree: HtmlTree, node: HtmlNode): string {
  const from = node.open + 1;
  const to = node.close >= 0 ? node.close : tree.tokens.length;
  let text = "";
  for (let i = from; i < to; i++) {
    const t = tree.tokens[i];
    if (t.kind === "text") text += decodeEntities(t.raw);
    else if (t.kind === "open" && t.name === "br") text += "\n";
  }
  return text;
}

/** Cambia el contenido de UN nodo marcado por un texto plano, sin limpiar (la limpieza es de `edit.ts`). `null` si no existe. */
export function replaceNodeText(html: string, id: string, text: string): string | null {
  const tree = buildTree(tokenizeHtml(html));
  const node = tree.nodes.find((n) => nodeAttr(n, TX_ATTR) === id);
  if (!node || node.close < 0) return null;
  const open = tree.tokens[node.open];
  const close = tree.tokens[node.close];
  return html.slice(0, open.end) + textToHtml(text.slice(0, 5000)) + html.slice(close.start);
}
