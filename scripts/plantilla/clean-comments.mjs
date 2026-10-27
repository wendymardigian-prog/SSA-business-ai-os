// Limpieza de los COMENTARIOS de la plantilla: les saca las referencias a la historia del
// proyecto (numeros de migracion, fechas, codigos de requerimiento como F87 o M10, "Bloque 2c",
// "Fase 3", "Extra I", "Contenido v4", "PR #12", "docs/PENDIENTE.md"...), para que quien recibe
// la plantilla no vea en que orden se fue construyendo el sistema.
//
// Reglas de seguridad:
//   - Solo se tocan comentarios (los encuentra comments.mjs con el parser de TypeScript): nunca
//     el codigo, nunca un string, nunca el texto de JSX.
//   - Un comentario con una directiva (eslint, @ts-expect-error, prettier...) no se toca.
//   - Se saca la referencia y lo que la acompaña ("desde la 00143", "(Extra I, F33 y F35)",
//     "Fase 3:"); el resto de la oracion queda. Una linea que queda vacia se va, y un
//     comentario que queda vacio se va entero (con su linea, y con las llaves si es de JSX).
//   - Una fecha de ejemplo (con dia de la semana, entre comillas o con hora) es un dato del
//     test, no historia: se deja.
//
// Lo usan el export (export-profile.mjs, despues de sacar las marcas) y el control de historia
// (`historyRefs`, con las mismas reglas: lo que la limpieza no saca, el control lo encuentra).
import { findComments } from "./comments.mjs";

const S = "\u0001"; // lo que se va a sacar, mientras se arregla lo que lo rodea
const P = "\u0002"; // lo mismo, para un parentesis entero (no deja nada colgando)
const Q = "\u0003"; // lo mismo, con su preposicion ("desde la 00143")

// --- Las referencias ----------------------------------------------------------------------

const MIGRATION = String.raw`(?<![\w-])00\d{3}(?:_[a-z0-9_]+)?(?:\.sql)?(?:'s)?(?![\w-])`;
const DATE = String.raw`(?<![\w/])\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}(?![\w/])`;
// Codigos de requerimiento: F87, FA6, AT3, M10, C9... (no: SHA256, ES256, ID3, GA1, T0, MP4,
// H1 a H3 de los titulos, ni un byte en hexadecimal como "E0 A1 B1", ni un "%C2%B7").
const CODE = String.raw`(?<![\w%#.\x60])(?:F\d{1,3}|(?:FA|FO|GF|WH|AT|AO|CM)\d{1,2}|H\d{2}|[ABCDEGIMNRS]\d{1,2})(?:\.\d+)*(?![\w%\x60])`;
const PHRASES = [
  String.raw`[Ee]xtra [A-Z]\b`,
  String.raw`[Bb]loques?\s+(?:Agentes IA|\d+[a-z]?\b|[A-Z]\b)(?:\s*(?:,|y|a|-)\s*(?:\d+[a-z]?|[A-Z])\b)*`,
  String.raw`(?:[Ff]ases?|[Ee]tapas?)\s+\d+\b`,
  String.raw`(?:revisi[oó]n\s+)?(?:Contenido|Agenda|[Bb]anca|Ventas|Chat)\s+v\d+\b`,
  String.raw`Tir[oó]n\s+\d+\b`,
  String.raw`\b[Tt]andas? [A-Z]\b`,
  String.raw`\b[Cc]orridas? [A-Z]\b`,
  String.raw`\b(?:las )?Mejoras de Chat\b`,
  String.raw`§\s?\d+(?:\.\d+)*`,
  String.raw`[Pp]lano formularios-ui`,
  String.raw`\bdecisi[oó]n \d{2,3}\b`,
  String.raw`requerimientos(?:-[\w-]+|\s+v\d+(?:\.\d+)*)`,
  String.raw`\bPR\s*#\s*\d+`,
  String.raw`\s?--despues-de-00\d{3}\b`,
  String.raw`(?<![\w/.:-])docs\/[\w./-]*\w`,
  String.raw`\bPENDIENTE(?:-[\w-]+)?(?:\.md)?\b`,
  String.raw`[Cc]ambio aprobado(?:\s+del Member)?(?:\s+M\d{1,2}\b)?(?:\s+el\s+${DATE})?`,
];
const CORE = `(?:${[MIGRATION, DATE, CODE, ...PHRASES].join("|")})`;
const ATOM = String.raw`(?:(?:\b(?:la|las|el)\s+)?(?:\b(?:migraci[oó]n(?:es)?|migrations?|plano|correcci[oó]n(?:es)?)\s+)?${CORE})`;
const SEP = String.raw`\s*(?:,|\/|\by\b|\be\b|\ba\b|\bal\b|-|–|·)\s*`;
const LIST = new RegExp(`${ATOM}(?:${SEP}${ATOM})*`, "g");

// Lo que va pegado adelante de una referencia y no tiene sentido sin ella.
const PREP = String.raw`(?:\b(?:[Dd]esde|DESDE|[Hh]asta|HASTA|[Aa]ntes de|ANTES de|[Dd]espu[eé]s de|DESPU[EÉ]S de|[Tt]ras|[Ee]n|[Dd]e|[Dd]el|[Pp]or|[Cc]on|[Ss]eg[uú]n|[Vv]er|[Cc]omo en|[Aa] partir del?|[Aa]l|[Dd]ecisi[oó]n del)\s+)`;
const PREP_S = new RegExp(`${PREP}+(?:(?:la|las|el|los)\\s+)?${S}`, "g");

// Palabras que, solas dentro de un parentesis, no dicen nada sin la referencia.
const FILLER = new RegExp(
  String.raw`^(?:[\s,.;:·–\-]|\b(?:la|las|el|los|de|del|y|e|a|en|ver|plano|migraci[oó]n(?:es)?|bloques?|secci[oó]n\s+\d+|requerimientos|decisi[oó]n|cambio aprobado|del Member|Member|compactado|parcial|revisi[oó]n|correcci[oó]n)\b|${S})*$`,
  "i",
);

// Directivas: un comentario que las tiene no se toca.
const DIRECTIVE = /eslint|@ts-|prettier-ignore|@vitest-environment|istanbul|\bc8\b|<reference|@jsx|@plantilla-/;

// Lineas con bytes en hexadecimal ("D0 CF 11 E0 A1 B1"): los codigos que aparezcan ahi son bytes.
const HEX_BYTES = /\b[0-9A-F]{2}(?: [0-9A-F]{2}){2,}\b/;

// Una fecha de ejemplo (un dato del test, no historia).
const WEEKDAY = /(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|dom)\s+$/i;
function isExampleDate(line, index, length) {
  const before = line.slice(0, index);
  const after = line.slice(index + length);
  if (WEEKDAY.test(before)) return true;
  if (/["'`«]\s*$/.test(before) || /^\s*["'`»]/.test(after)) return true;
  if (/^,?\s*\d{1,2}:\d{2}/.test(after)) return true;
  // "empieza dom 8/3/2026, termina dom 1/11/2026": ya cubierto por el dia de la semana.
  return false;
}

// Un nombre de archivo de ejemplo (`00042_algo.sql`): explica el formato, no cuenta historia.
const isExampleFile = (line, index, match) => line[index - 1] === "\x60" && /^00\d{3}_(?:algo|ejemplo|nombre|descripcion)\b/.test(match);

/** Marca con S las referencias de una linea (sin sacarlas todavia). */
function markRefs(line) {
  const hex = HEX_BYTES.test(line);
  return line.replace(LIST, (match, offset) => {
    // Dentro de la lista, una fecha de ejemplo o un byte la anulan entera.
    const dateRe = new RegExp(DATE, "g");
    for (const d of match.matchAll(dateRe)) if (isExampleDate(line, offset + d.index, d[0].length)) return match;
    if (hex && new RegExp(`^${CODE}$`).test(match.trim())) return match;
    if (isExampleFile(line, offset, match)) return match;
    return S;
  }).replace(new RegExp(`\x60${S}\x60|"${S}"`, "g"), S);
}

const capitalize = (text) => text.replace(/^([\s─—=#*·\-]*)(\p{Ll})/u, (_, pre, ch) => pre + ch.toUpperCase());

/**
 * Limpia una linea de un comentario (sin el "//" ni el " * "). Devuelve el texto limpio, o
 * null si la linea quedo vacia (tenia texto y era solo historia).
 */
// Lo que queda colgando si se saca la referencia que sigue ("es F25.", "anterior a la 00134",
// "lo suma la 00099:"): esas oraciones no se pueden arreglar solas y se reescriben a mano.
const DANGLING = /(?:^|[\s(])(?:es|son|era|que|la|el|las|los|a|y|o|e|suma|sumo|motivo|llega|aplique|cerrar|anterior)\s*$/i;

export function cleanCommentLine(line, warnings) {
  if (DIRECTIVE.test(line)) return line;
  let t = markRefs(line);
  if (!t.includes(S)) return line;

  // Los parentesis: se van los items que eran solo referencias; si no queda ninguno, el parentesis entero.
  t = t.replace(/\s*\(([^()]*)\)/g, (whole, inner) => {
    if (!inner.includes(S)) return whole;
    const lead = whole.slice(0, whole.indexOf("("));
    const kept = inner
      .split(/[,;]/)
      .map((s) => s.trim().replace(new RegExp(`^${S}\\s*[:·]\\s*`), ""))
      .filter((item) => item && !FILLER.test(item.replace(PREP_S, S)));
    if (kept.length === 0) return P;
    const body = kept.join(", ").replace(PREP_S, S).replace(new RegExp(`\\s*${S}\\s*`, "g"), " ").replace(/\s+/g, " ").trim().replace(/[.:]$/, "");
    if (!body || FILLER.test(body)) return P;
    return `${lead}(${body})`;
  });

  // "desde la 00143", "Antes de F46", "el 26/9/2026" -> una sola marca (Q: lo que sigue es una
  // oracion completa, "Desde la Fase 3 los entrantes..." -> "Los entrantes...").
  t = t.replace(PREP_S, Q);
  // Varias marcas seguidas -> una.
  t = t.replace(new RegExp(`[${S}${Q}](?:\\s*[,/·–-]?\\s*[${S}${Q}])+`, "g"), (m) => (m.includes(Q) ? Q : S));
  if (warnings) {
    for (const m of t.matchAll(new RegExp(`[${S}${Q}]`, "g"))) {
      const before = t.slice(0, m.index);
      const after = t.slice(m.index + 1);
      // "...es F25." o "...anterior a la 00134": lo que queda pide la referencia.
      const dangling = DANGLING.test(before);
      // "El Bloque 1 asumio...": la referencia era el sujeto de la oracion.
      const subject = m[0] === S && (/[.!?]\s*$/.test(before) || !/\S/.test(before)) && /^\s*\p{Ll}/u.test(after);
      if (dangling || subject) warnings.push(line.trim());
    }
  }
  t = t.replaceAll(P, S).replaceAll(Q, S).replace(new RegExp(`${S}(?:\\s*${S})+`, "g"), S);
  // Un inciso entre comas que era solo la referencia: ", desde el Extra I, «Atribucion»" -> " «Atribucion»".
  t = t.replace(new RegExp(`,\\s*${S}\\s*,\\s*`, "g"), " ");
  // Al principio de un parentesis: "(§5: nadie...)" -> "(nadie...)".
  t = t.replace(new RegExp(`(?<=\\()\\s*${S}\\s*[:·,]\\s*`, "g"), "");

  // Al principio: "00259: esperando..." -> "Esperando...".
  let leading = false;
  t = t.replace(new RegExp(`^([\\s─—=#*·\\-]*)${S}\\s*(?:[:·,.–-]+\\s*)?`), (_, pre) => {
    leading = true;
    return pre;
  });

  // Lo demas: se saca la marca y se arregla el espacio y la puntuacion de alrededor.
  t = t
    .replace(new RegExp(`\\s*${S}(?=\x60)`, "g"), "")
    .replace(new RegExp(`\\s*${S}\\s*(?=[,.;:)!?]|$)`, "g"), "")
    .replace(new RegExp(`(?<=[(«])\\s*${S}\\s*`, "g"), "")
    .replace(new RegExp(`(?<=\\S)\\s*${S}\\s*(?=\\S)`, "g"), " ")
    .replace(new RegExp(S, "g"), "")
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*(?=[,.;:)])/g, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/:\s*\./g, ".")
    .replace(/(\S) {2,}(?=\S)/g, (m, c) => (m.length > 3 ? m : `${c} `))
    .replace(/\s+$/, "");
  if (leading) t = capitalize(t);
  // Una coma o dos puntos que quedaron al principio.
  t = t.replace(/^(\s*)[,;:·]\s*/, (_, pre) => pre);
  if (/\p{L}|\d/u.test(line) && !/[\p{L}\d]/u.test(t)) return null;
  // Solo quedaron palabras sueltas sin la referencia ("Ver", "plano").
  if (FILLER.test(t.trim())) return null;
  return t;
}

// --- Un archivo entero -------------------------------------------------------------------

/**
 * Limpia los comentarios de un archivo. Devuelve { text, changed, warnings }: changed = cuantos
 * comentarios toco; warnings = las lineas que quedaron con algo colgando (hay que reescribirlas
 * a mano en el proyecto, ver DANGLING).
 */
export function cleanSource(text, file) {
  const comments = findComments(text, file);
  const warnings = [];
  if (comments.length === 0) return { text, changed: 0, warnings };
  let out = "";
  let last = 0;
  let changed = 0;
  for (const c of comments) {
    const raw = text.slice(c.start, c.end);
    const next = cleanComment(raw, c.kind, warnings);
    if (next === raw) continue;
    changed++;
    if (next !== null) {
      out += text.slice(last, c.start) + next;
      last = c.end;
      continue;
    }
    // El comentario entero se va: con su linea si estaba solo, con las llaves si es de JSX.
    let start = c.start;
    let end = c.end;
    const before = text.slice(0, start);
    const jsxOpen = /\{\s*$/.exec(before);
    const jsxClose = /^\s*\}/.exec(text.slice(end));
    if (jsxOpen && jsxClose) {
      start -= jsxOpen[0].length;
      end += jsxClose[0].length;
    }
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = text.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const alone = /^\s*$/.test(text.slice(lineStart, start)) && /^\s*$/.test(text.slice(end, lineEnd));
    if (alone) {
      start = lineStart;
      end = lineEndIdx === -1 ? text.length : lineEndIdx + 1;
    } else {
      // Al final de una linea con codigo: se van tambien los espacios de antes.
      while (start > lineStart && /[ \t]/.test(text[start - 1])) start--;
    }
    out += text.slice(last, start);
    last = end;
  }
  out += text.slice(last);
  return { text: out, changed, warnings };
}

/** Un comentario limpio; null si queda vacio. */
function cleanComment(raw, kind, warnings) {
  if (DIRECTIVE.test(raw) || raw.startsWith("///") || raw.startsWith("#!")) return raw;
  if (kind === "line") {
    const m = /^(\/\/|--)(.*)$/s.exec(raw);
    if (!m) return raw;
    const next = cleanCommentLine(m[2], warnings);
    if (next === null) return null;
    return next === m[2] ? raw : m[1] + next;
  }
  // Bloque: linea por linea.
  const lines = raw.split("\n");
  const out = [];
  let touched = false;
  let content = 0;
  lines.forEach((line, i) => {
    const first = i === 0;
    const lastLine = i === lines.length - 1;
    let pre;
    let body;
    let post = "";
    if (first) {
      const m = /^(\/\*\*?)(.*)$/s.exec(line);
      pre = m[1];
      body = m[2];
    } else {
      const m = /^(\s*\*?(?!\/))(.*)$/s.exec(line);
      pre = m[1];
      body = m[2];
    }
    if (lastLine) {
      const k = body.lastIndexOf("*/");
      post = body.slice(k);
      body = body.slice(0, k);
    }
    const next = cleanCommentLine(body, warnings);
    if (next !== body) touched = true;
    if (next === null) {
      if (first || lastLine) out.push(pre + post.trimStart());
      // una linea del medio que quedo vacia se va entera
      return;
    }
    if (/\S/.test(next)) content++;
    let rebuilt = pre + next + post;
    if (first && lastLine && next !== body) rebuilt = pre + next.replace(/\s*$/, " ") + post;
    out.push(rebuilt);
  });
  if (!touched) return raw;
  if (content === 0) return null;
  // Lineas en blanco seguidas (" *" y " *") que quedaron al sacar una del medio: una sola.
  const merged = out.filter((l, i) => !(i > 0 && /^\s*\*?\s*$/.test(l) && /^\s*\*?\s*$/.test(out[i - 1]) && i < out.length - 1));
  // Un "/**" o "/*" seguido directo de "*/".
  const text = merged.join("\n");
  return text.replace(/^(\/\*\*?)\s*\n\s*\*\/$/, "$1 */");
}

// --- El control --------------------------------------------------------------------------

/**
 * Las referencias a la historia que tiene un comentario, con las mismas reglas que la limpieza:
 * [{ rule, match }]. Una fecha de ejemplo no cuenta. Lo usa el control de historia del export.
 */
export function historyRefs(commentText) {
  if (DIRECTIVE.test(commentText)) return [];
  const hits = [];
  for (const line of commentText.split("\n")) {
    const hex = HEX_BYTES.test(line);
    const checks = [
      ["numero de migracion", MIGRATION],
      ["fecha", DATE],
      ["codigo de requerimiento", CODE],
      ["etapa del proyecto", PHRASES.join("|")],
    ];
    for (const [rule, src] of checks) {
      for (const m of line.matchAll(new RegExp(src, "g"))) {
        if (rule === "fecha" && isExampleDate(line, m.index, m[0].length)) continue;
        if (rule === "numero de migracion" && isExampleFile(line, m.index, m[0])) continue;
        if (rule === "codigo de requerimiento" && hex) continue;
        hits.push({ rule, match: m[0] });
      }
    }
  }
  return hits;
}
