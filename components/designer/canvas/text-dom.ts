import { domToNodes, normalizeNodes, serializeText, type Cursor, type MinimalNode, type TextNode } from "@/lib/designer/screens/variables";

/**
 * El campo editable de un texto con chips de variables (F18, F24). Lo que es del DOM vive acá; las decisiones
 * (dónde queda la variable, cómo se guarda) son de `lib/designer/screens/variables.ts`.
 *
 * El contenido se arma a mano (`createElement` / `createTextNode`), nunca con HTML en texto: lo que escribe la persona
 * no pasa por un `innerHTML`.
 */

/** Cómo se ve un chip de variable en el lienzo (clase completa: Tailwind genera lo que lee en el código). */
export const CHIP_CLASS = "inline-block cursor-pointer rounded-[0.35em] bg-primary/20 px-[0.35em] font-semibold text-primary-ink [white-space:nowrap]";

/** Pinta los nodos dentro del campo: texto, chips (no editables, con `data-var`) y saltos de línea. */
export function renderNodesInto(root: HTMLElement, nodes: readonly TextNode[], labelFor: (key: string) => string): void {
  const children: Node[] = nodes.map((node) => {
    if (node.kind === "br") return document.createElement("br");
    if (node.kind === "text") return document.createTextNode(node.text);
    const chip = document.createElement("span");
    chip.className = CHIP_CLASS;
    chip.contentEditable = "false";
    chip.dataset.var = node.key;
    chip.title = `{{${node.key}}}`;
    chip.textContent = labelFor(node.key);
    return chip;
  });
  root.replaceChildren(...children);
}

/** Lo que hay escrito en el campo, ya como nodos normalizados y como el texto que se guarda. */
export function readField(root: HTMLElement): { nodes: TextNode[]; text: string } {
  const nodes = normalizeNodes(domToNodes(root as unknown as MinimalNode));
  return { nodes, text: serializeText(nodes) };
}

/** Dónde está el cursor dentro del campo (índice del nodo de primer nivel y caracteres antes), o null si no está adentro. */
export function cursorIn(root: HTMLElement): Cursor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== root) node = node.parentNode;
  if (!node) return { index: root.childNodes.length, offset: 0 };
  const index = Array.prototype.indexOf.call(root.childNodes, node) as number;
  if (node === range.startContainer && node.nodeType === Node.TEXT_NODE) return { index, offset: range.startOffset };
  return { index, offset: range.startContainer === root ? 0 : 1 };
}

/** Pone el cursor justo antes del nodo `index` de primer nivel (o al final). */
export function placeCursor(root: HTMLElement, index: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (index >= root.childNodes.length) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    range.setStartBefore(root.childNodes[index]);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
