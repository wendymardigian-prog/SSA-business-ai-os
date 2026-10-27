// Donde estan los comentarios de un archivo: [{ start, end, kind: "line" | "block" }].
//
// Para TypeScript y JavaScript (con y sin JSX) no se adivina: se usa el parser de
// TypeScript, que sabe distinguir un comentario de un string, de un template, de una
// expresion regular o del texto de JSX (`<p>http://...</p>` NO es un comentario; `{/* */}`
// si). Para CSS y SQL alcanza con un recorrido chico que respeta los strings.
//
// Lo usan la limpieza de comentarios del export (clean-comments.mjs) y el control de
// historia (export-profile.mjs), que revisa solo los comentarios.
import ts from "typescript";

const JS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** La forma de leer los comentarios de un archivo, o null si no es de un tipo conocido. */
export function commentLanguage(file) {
  if (JS_EXT.test(file)) return "js";
  if (/\.css$/.test(file)) return "css";
  if (/\.sql$/.test(file)) return "sql";
  return null;
}

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.JsxTextAllWhiteSpaces,
]);

function jsComments(text, file) {
  // Un .js con JSX (raro) se lee como JSX para que su texto no parezca un comentario.
  const kind = scriptKind(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const found = new Map();
  // Lo que es texto de verdad (strings, templates, regex, texto de JSX): un "comentario"
  // que arranca adentro de esto no es un comentario.
  const literals = [];
  const add = (ranges) => {
    for (const r of ranges ?? []) if (!found.has(r.pos)) found.set(r.pos, r);
  };
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (LITERAL_KINDS.has(node.kind)) {
      literals.push([node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces ? node.pos : node.getStart(sf), node.end]);
      if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);
  const inLiteral = (pos) => literals.some(([s, e]) => pos >= s && pos < e);
  return [...found.values()]
    .filter((r) => !inLiteral(r.pos))
    .filter((r) => text.startsWith("//", r.pos) || text.startsWith("/*", r.pos))
    .map((r) => ({ start: r.pos, end: r.end, kind: text.startsWith("//", r.pos) ? "line" : "block" }))
    .sort((a, b) => a.start - b.start);
}

/** CSS: `/* *\/` fuera de strings. */
function cssComments(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out.push({ start: i, end: stop, kind: "block" });
      i = stop;
    } else i++;
  }
  return out;
}

/** SQL: `--` y `/* *\/` fuera de strings ('...', "..." y $tag$...$tag$). */
function sqlComments(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === c) {
          if (text[i + 1] === c) i += 2;
          else break;
        } else i++;
      }
      i++;
    } else if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (!m) {
        i++;
        continue;
      }
      // El cuerpo de una funcion ($$ ... $$) es codigo: sus comentarios tambien cuentan,
      // asi que se sigue leyendo adentro en vez de saltearlo como un string.
      i += m[0].length;
    } else if (c === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out.push({ start: i, end: stop, kind: "line" });
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out.push({ start: i, end: stop, kind: "block" });
      i = stop;
    } else i++;
  }
  return out;
}

/** Los comentarios del texto, en orden. [] si el tipo de archivo no se conoce. */
export function findComments(text, file) {
  const lang = commentLanguage(file);
  if (lang === "js") return jsComments(text, file);
  if (lang === "css") return cssComments(text);
  if (lang === "sql") return sqlComments(text);
  return [];
}

/**
 * El codigo de un archivo sin sus comentarios: la lista de sus tokens (el texto de JSX con
 * los espacios juntados, y sin los `{}` vacios que deja un comentario de JSX). Sirve para
 * comprobar que una limpieza de comentarios no toco nada mas: antes y despues tiene que dar
 * lo mismo. Solo para TypeScript/JavaScript; para otro tipo de archivo devuelve null.
 */
export function codeTokens(text, file) {
  if (commentLanguage(file) !== "js") return null;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file));
  const out = [];
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind === ts.SyntaxKind.JsxExpression && !node.expression && !node.dotDotDotToken) return;
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      const t = node.getText(sf).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) out.push(node.getText(sf));
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);
  return out;
}
