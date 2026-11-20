// @plantilla-quitar(servicios)
/**
 * El texto de la página HTML de una clase (puro), para que el tutor la pueda leer: se guarda en Conocimiento igual que
 * la transcripción de un video. Se queda solo con lo que la persona lee en pantalla: sin `<head>`, estilos, scripts ni
 * comentarios; los títulos y párrafos quedan en su propio renglón, las listas con guion y el `<pre>` tal cual.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…",
  iexcl: "¡", iquest: "¿", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", middot: "·", bull: "•",
  rarr: "→", larr: "←", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", copy: "©", reg: "®", deg: "°", times: "×",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? m;
  });
}

const BLOCK = "p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|table|tr|blockquote|figure|figcaption|details|summary|dl|dt|dd|hr|form|fieldset";

export function pageText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|title)[\s>][\s\S]*?<\/\1>/gi, " ");
  // El <pre> conserva sus renglones: se aparta antes de juntar los espacios.
  const pres: string[] = [];
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    pres.push(decode(inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\u00a0/g, " ").trim());
    return `\n\n\u0000${pres.length - 1}\u0000\n\n`;
  });
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    // Dos etiquetas en línea pegadas («<span>A</span><span>B</span>») se ven separadas en pantalla: acá también.
    .replace(/(<\/(?:span|a|label|button|small|code|em|strong|b|i)>)(?=<[a-z])/gi, "$1 ")
    .replace(/<li(\s[^>]*)?>/gi, "\n- ")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(new RegExp(`<\\/?(${BLOCK})(\\s[^>]*)?\\/?>`, "gi"), "\n\n")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\r]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => pres[Number(i)] ?? "");
}
