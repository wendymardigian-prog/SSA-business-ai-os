/**
 * Un lector de HTML chiquito, solo para MIRAR la estructura (DS4): detectar si un
 * archivo es una presentación, marcar los textos editables y juntar los `<style>`.
 *
 * No limpia nada: la limpieza es de `sanitize.ts` (con `sanitize-html`). Este módulo
 * se usa sobre HTML que ya pasó por esa limpieza (bien formado) o, en la detección,
 * sobre el archivo tal cual lo subió la persona; en los dos casos lo que se escribe
 * al diseño sale siempre de la limpieza, nunca de acá. No usa el DOM del navegador
 * (corre en el servidor).
 *
 * Módulo puro.
 */

export interface HtmlAttr {
  name: string;
  value: string;
}

export type HtmlToken =
  | { kind: "text"; start: number; end: number; raw: string }
  | { kind: "comment"; start: number; end: number; raw: string }
  | { kind: "open"; start: number; end: number; raw: string; name: string; attrs: HtmlAttr[]; selfClosing: boolean }
  | { kind: "close"; start: number; end: number; raw: string; name: string };

/** Las etiquetas que no tienen cierre. */
export const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Las etiquetas cuyo contenido es texto crudo (no se mira adentro). */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe"]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodifica las entidades más comunes de un valor de atributo. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Un texto plano como HTML: escapado y con los saltos de línea como `<br />`. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br />");
}

function isAlpha(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch);
}

/** Lee los atributos de una etiqueta de apertura desde `i` hasta el `>`. Devuelve dónde terminó. */
function readAttributes(html: string, from: number): { attrs: HtmlAttr[]; end: number; selfClosing: boolean } {
  const attrs: HtmlAttr[] = [];
  let i = from;
  let selfClosing = false;
  while (i < html.length) {
    const ch = html[i];
    if (ch === ">") return { attrs, end: i + 1, selfClosing };
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/") {
      selfClosing = html[i + 1] === ">";
      i++;
      continue;
    }
    let j = i;
    while (j < html.length && !/[\s=/>]/.test(html[j])) j++;
    if (j === i) {
      i++;
      continue;
    }
    const name = html.slice(i, j).toLowerCase();
    i = j;
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? html.length : close;
        value = html.slice(i + 1, stop);
        i = close === -1 ? html.length : close + 1;
      } else {
        let k = i;
        while (k < html.length && !/[\s>]/.test(html[k])) k++;
        value = html.slice(i, k);
        i = k;
      }
    }
    attrs.push({ name, value: decodeEntities(value) });
    selfClosing = false;
  }
  return { attrs, end: html.length, selfClosing: false };
}

/** Parte el HTML en etiquetas, texto y comentarios. Nunca lanza. */
export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  let textStart = 0;
  const flushText = (until: number) => {
    if (until > textStart) tokens.push({ kind: "text", start: textStart, end: until, raw: html.slice(textStart, until) });
  };
  while (i < html.length) {
    if (html[i] !== "<") {
      i++;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      flushText(i);
      const close = html.indexOf("-->", i + 4);
      const end = close === -1 ? html.length : close + 3;
      tokens.push({ kind: "comment", start: i, end, raw: html.slice(i, end) });
      i = end;
      textStart = i;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      flushText(i);
      const close = html.indexOf(">", i + 2);
      const end = close === -1 ? html.length : close + 1;
      tokens.push({ kind: "comment", start: i, end, raw: html.slice(i, end) });
      i = end;
      textStart = i;
      continue;
    }
    if (html[i + 1] === "/" && isAlpha(html[i + 2])) {
      flushText(i);
      let j = i + 2;
      while (j < html.length && !/[\s/>]/.test(html[j])) j++;
      const name = html.slice(i + 2, j).toLowerCase();
      const close = html.indexOf(">", j);
      const end = close === -1 ? html.length : close + 1;
      tokens.push({ kind: "close", start: i, end, raw: html.slice(i, end), name });
      i = end;
      textStart = i;
      continue;
    }
    if (isAlpha(html[i + 1])) {
      flushText(i);
      let j = i + 1;
      while (j < html.length && !/[\s/>]/.test(html[j])) j++;
      const name = html.slice(i + 1, j).toLowerCase();
      const { attrs, end, selfClosing } = readAttributes(html, j);
      tokens.push({ kind: "open", start: i, end, raw: html.slice(i, end), name, attrs, selfClosing });
      i = end;
      textStart = i;
      if (RAW_TEXT_TAGS.has(name) && !selfClosing) {
        const closeRe = new RegExp(`</${name}(?=[\\s/>])`, "i");
        const rest = html.slice(i);
        const found = closeRe.exec(rest);
        const rawEnd = found ? i + found.index : html.length;
        if (rawEnd > i) tokens.push({ kind: "text", start: i, end: rawEnd, raw: html.slice(i, rawEnd) });
        i = rawEnd;
        textStart = i;
      }
      continue;
    }
    i++;
  }
  flushText(html.length);
  return tokens;
}

export function attrOf(token: HtmlToken, name: string): string | undefined {
  if (token.kind !== "open") return undefined;
  return token.attrs.find((a) => a.name === name)?.value;
}

// ─── Árbol liviano ──────────────────────────────────────────────────────────

export interface HtmlNode {
  /** Índice del token de apertura. */
  open: number;
  /** Índice del token de cierre (o -1 si no tiene: vacía o sin cerrar). */
  close: number;
  name: string;
  attrs: HtmlAttr[];
  parent: HtmlNode | null;
  children: HtmlNode[];
  /** Los tokens de texto que son hijos directos. */
  textTokens: number[];
}

export interface HtmlTree {
  tokens: HtmlToken[];
  roots: HtmlNode[];
  nodes: HtmlNode[];
  /** Los tokens de texto que no están dentro de ningún elemento. */
  rootText: number[];
}

/** Arma el árbol de elementos. Un cierre sin apertura se ignora; lo que quedó abierto se cierra al final. */
export function buildTree(tokens: HtmlToken[]): HtmlTree {
  const roots: HtmlNode[] = [];
  const nodes: HtmlNode[] = [];
  const stack: HtmlNode[] = [];
  const rootText: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === "text") {
      const top = stack[stack.length - 1];
      if (top) top.textTokens.push(index);
      else rootText.push(index);
      return;
    }
    if (token.kind === "open") {
      const parent = stack[stack.length - 1] ?? null;
      const node: HtmlNode = { open: index, close: -1, name: token.name, attrs: token.attrs, parent, children: [], textTokens: [] };
      nodes.push(node);
      (parent ? parent.children : roots).push(node);
      if (!VOID_TAGS.has(token.name) && !token.selfClosing) stack.push(node);
      return;
    }
    if (token.kind === "close") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === token.name) {
          stack[s].close = index;
          stack.length = s;
          return;
        }
      }
    }
  });
  return { tokens, roots, nodes, rootText };
}

export function nodeAttr(node: HtmlNode, name: string): string | undefined {
  return node.attrs.find((a) => a.name === name)?.value;
}

export function nodeClasses(node: HtmlNode): string[] {
  return (nodeAttr(node, "class") ?? "").split(/\s+/).filter(Boolean);
}

/** El HTML completo de un elemento (apertura, contenido y cierre). */
export function outerHtml(tree: HtmlTree, node: HtmlNode, source: string): string {
  const startTok = tree.tokens[node.open];
  const endTok = node.close >= 0 ? tree.tokens[node.close] : tree.tokens[tree.tokens.length - 1];
  return source.slice(startTok.start, node.close >= 0 ? endTok.end : source.length);
}
