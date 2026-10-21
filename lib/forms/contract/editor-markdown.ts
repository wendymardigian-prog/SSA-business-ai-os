/**
 * La ida y vuelta entre el editor con formato (Tiptap) y el Markdown acotado del contrato. PURO: trabaja sobre el
 * documento del editor en JSON, sin DOM, así se prueba con Vitest.
 *
 * El contrato se GUARDA en Markdown (`form_versions.contract_text`): la huella, la página pública y el PDF leen ese
 * texto, y una versión ya publicada no cambia. El editor es solo la forma cómoda de escribirlo:
 *  - `markdownToEditorDoc`: lo guardado → lo que muestra el editor (con `renderContractMarkdown`, el MISMO lector
 *    que la página y el PDF).
 *  - `editorDocToMarkdown`: lo que armó la persona → lo que se guarda. Escapa los caracteres que el lector tomaría
 *    como formato, así cualquier texto vuelve igual.
 *
 * Lo que el Markdown no tiene (listas adentro de listas, saltos dentro de un título o de un ítem) se aplana: nunca se
 * pierde texto.
 */
import { renderContractMarkdown, type InlineRun } from "./markdown";

/** El nodo del editor (el `JSONContent` de Tiptap, sin importar Tiptap). */
export interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/** Una variable del contrato: `{{respuesta.empresa}}`, `{{contacto.nombre}}`. */
export const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

// ---------------------------------------------------------------------------
// Markdown → editor
// ---------------------------------------------------------------------------

function marksOf(run: InlineRun): DocNode["marks"] {
  const marks: NonNullable<DocNode["marks"]> = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.href) marks.push({ type: "link", attrs: { href: run.href } });
  return marks.length ? marks : undefined;
}

function withMarks(node: DocNode, marks: DocNode["marks"]): DocNode {
  return marks ? { ...node, marks } : node;
}

/** Un tramo de texto → nodos del editor: los saltos son `hardBreak` y las variables, fichas. */
function runToNodes(run: InlineRun): DocNode[] {
  const marks = marksOf(run);
  const nodes: DocNode[] = [];
  run.text.split("\n").forEach((line, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    let last = 0;
    for (const match of line.matchAll(VARIABLE_PATTERN)) {
      const at = match.index ?? 0;
      if (at > last) nodes.push(withMarks({ type: "text", text: line.slice(last, at) }, marks));
      nodes.push(withMarks({ type: "variable", attrs: { name: match[1] } }, marks));
      last = at + match[0].length;
    }
    if (last < line.length) nodes.push(withMarks({ type: "text", text: line.slice(last) }, marks));
  });
  return nodes;
}

function inline(runs: InlineRun[]): DocNode[] | undefined {
  const nodes = runs.flatMap(runToNodes);
  return nodes.length ? nodes : undefined;
}

function paragraph(runs: InlineRun[]): DocNode {
  const content = inline(runs);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

export function markdownToEditorDoc(markdown: string): DocNode {
  const content: DocNode[] = renderContractMarkdown(markdown).map((block) => {
    if (block.type === "heading") {
      const nodes = inline(block.runs);
      return { type: "heading", attrs: { level: block.level }, ...(nodes ? { content: nodes } : {}) };
    }
    if (block.type === "paragraph") return paragraph(block.runs);
    return {
      type: block.ordered ? "orderedList" : "bulletList",
      ...(block.ordered ? { attrs: { start: 1 } } : {}),
      content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
    };
  });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ---------------------------------------------------------------------------
// Editor → Markdown
// ---------------------------------------------------------------------------

/** Un pedazo de texto ya plano, con su formato. `raw` = va tal cual (una variable o un salto), sin escapar. */
interface Segment {
  text: string;
  raw?: boolean;
  bold: boolean;
  italic: boolean;
  href: string | null;
}

/** Lo que el lector de Markdown tomaría como formato. */
export function escapeInline(text: string): string {
  return text.replace(/[\\*_[\]]/g, (c) => `\\${c}`);
}

/** Un renglón que empieza como título o como ítem de lista y no lo es: se escapa su primer carácter. */
function escapeLineStart(line: string): string {
  if (/^#{1,6}\s/.test(line) || /^[-+]\s/.test(line)) return `\\${line}`;
  const numbered = /^(\d+)([.)])(\s)/.exec(line);
  if (numbered) return `${numbered[1]}\\${numbered[2]}${line.slice(numbered[1].length + 1)}`;
  return line;
}

function segmentsOf(nodes: DocNode[] | undefined, breakAs: string): Segment[] {
  const segments: Segment[] = [];
  for (const node of nodes ?? []) {
    const marks = node.marks ?? [];
    const link = marks.find((m) => m.type === "link");
    const base = {
      bold: marks.some((m) => m.type === "bold"),
      italic: marks.some((m) => m.type === "italic"),
      href: typeof link?.attrs?.href === "string" ? (link.attrs.href as string) : null,
    };
    if (node.type === "text" && node.text) segments.push({ ...base, text: node.text });
    else if (node.type === "variable" && typeof node.attrs?.name === "string") segments.push({ ...base, text: `{{${node.attrs.name}}}`, raw: true });
    else if (node.type === "hardBreak") segments.push({ text: breakAs, raw: true, bold: false, italic: false, href: null });
    else if (node.content) segments.push(...segmentsOf(node.content, breakAs));
  }
  return segments;
}

/** Corta una lista en tandas consecutivas que comparten una clave. */
function groupBy<T, K>(items: T[], key: (item: T) => K): Array<{ key: K; items: T[] }> {
  const groups: Array<{ key: K; items: T[] }> = [];
  for (const item of items) {
    const k = key(item);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(item);
    else groups.push({ key: k, items: [item] });
  }
  return groups;
}

const plain = (segments: Segment[]) => segments.map((s) => (s.raw ? s.text : escapeInline(s.text))).join("");

/** Los espacios del borde quedan afuera de las marcas (`** a **` no es negrita). */
function wrap(delimiter: string, inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match || !match[2]) return inner;
  return `${match[1]}${delimiter}${match[2]}${delimiter}${match[3]}`;
}

/**
 * La cursiva va con `_` salvo en el medio de una palabra (ahí el lector no lo acepta) y entonces con `*`. Con `_`,
 * una cursiva pegada a una negrita (`**`) no se confunde con ella.
 */
function italicDelimiter(before: string, after: string): string {
  return /\w$/.test(before) || /^\w/.test(after) ? "*" : "_";
}

/**
 * Arma un nivel de formato. Las tandas CON la marca se arman primero (no dependen de lo que tienen al lado); las que
 * no la tienen, después, porque su delimitador interno depende de los caracteres que de verdad les quedan pegados en
 * la salida (un `**` o un `[` de la tanda vecina, no el texto de adentro).
 */
function serializeLevel(
  segments: Segment[],
  key: (s: Segment) => unknown,
  marked: (items: Segment[], groupKey: unknown) => string,
  unmarked: (items: Segment[], before: string, after: string) => string,
  before: string,
  after: string,
): string {
  const groups = groupBy(segments, key);
  const out: Array<string | null> = groups.map((g) => (g.key ? marked(g.items, g.key) : null));
  groups.forEach((g, i) => {
    if (g.key) return;
    const prev = before + out.slice(0, i).join("");
    const next = out.slice(i + 1).map((x) => x ?? "").join("") + after;
    out[i] = unmarked(g.items, prev, next);
  });
  return out.join("");
}

function serializeItalic(segments: Segment[], before: string, after: string): string {
  const groups = groupBy(segments, (s) => s.italic);
  const out = groups.map((g) => plain(g.items));
  return groups
    .map((group, index) => {
      if (!group.key) return out[index];
      const prev = before + out.slice(0, index).join("");
      const next = out.slice(index + 1).join("") + after;
      return wrap(italicDelimiter(prev, next), out[index]);
    })
    .join("");
}

function serializeBold(segments: Segment[], before: string, after: string): string {
  return serializeLevel(
    segments,
    (s) => s.bold,
    (items) => wrap("**", serializeItalic(items, "", "")),
    serializeItalic,
    before,
    after,
  );
}

function serializeInline(segments: Segment[]): string {
  return serializeLevel(
    segments,
    (s) => s.href,
    (items, href) => {
      const label = serializeBold(items, "", "");
      if (!label.trim()) return label;
      const safe = String(href).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
      return `[${label}](${safe})`;
    },
    serializeBold,
    "",
    "",
  );
}

function textOf(node: DocNode, breakAs: string): string {
  return serializeInline(segmentsOf(node.content, breakAs));
}

function blockToMarkdown(node: DocNode): string[] {
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3);
      const text = textOf(node, " ").trim();
      return text ? [`${"#".repeat(level)} ${text}`] : [];
    }
    case "paragraph": {
      const text = textOf(node, "\n");
      if (!text.trim()) return [];
      return [text.split("\n").map(escapeLineStart).join("\n")];
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const items: string[] = [];
      const collect = (list: DocNode) => {
        for (const item of list.content ?? []) {
          // El texto del ítem (sus párrafos, en una línea) y, después, sus sublistas aplanadas.
          const own = (item.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList");
          const text = own.map((c) => textOf(c, " ")).join(" ").trim();
          if (text) items.push(text);
          for (const sub of item.content ?? []) if (sub.type === "bulletList" || sub.type === "orderedList") collect(sub);
        }
      };
      collect(node);
      if (!items.length) return [];
      return [items.map((text, i) => `${ordered ? `${i + 1}.` : "-"} ${text}`).join("\n")];
    }
    default:
      return node.content ? node.content.flatMap(blockToMarkdown) : [];
  }
}

export function editorDocToMarkdown(doc: DocNode): string {
  return (doc.content ?? []).flatMap(blockToMarkdown).join("\n\n");
}
