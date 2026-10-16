/**
 * El HTML de un email que sale de una automatizacion.
 *
 * El editor de texto enriquecido guarda HTML en el mismo campo `body` de
 * siempre. Eso abre un riesgo que el texto plano no tenia: los valores de las
 * variables (el nombre del contacto, algo que llego por un webhook) se pegaban
 * SIN escapar. Con HTML, un nombre como `<a href="...">` terminaria siendo un
 * link en el correo. Por eso:
 *
 *  1. Si el cuerpo es HTML se decide mirando la PLANTILLA, antes de pegar
 *     ningun valor (`isHtmlTemplate`). Mirar el texto ya interpolado hacia que
 *     un cuerpo en texto plano con un nombre `<b>x</b>` pasara por HTML.
 *  2. Las variables de un cuerpo HTML se pegan escapadas (`interpolateHtml`).
 *  3. Lo que sale pasa por una lista blanca de etiquetas (`sanitizeEmailHtml`),
 *     que corre DESPUES de pegar los valores.
 *  4. Se le ponen estilos en linea (`inlineEmailStyles`): Gmail, Outlook y
 *     Apple Mail no respetan una hoja de estilos del <head> de forma pareja.
 *
 * Puro y sin DOM: corre igual en el servidor, en los tests y en el navegador.
 */

import { resolveVariablePath } from "@/lib/flow-engine/interpolate";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** ¿La plantilla trae etiquetas HTML? (el texto plano nunca las trae a proposito) */
export function isHtmlTemplate(template: string): boolean {
  return /<(p|br|strong|b|em|i|u|s|h[1-6]|ul|ol|li|a|span|div|blockquote|hr)\b[^>]*>/i.test(template);
}

/** Como `interpolateVariables`, pero cada valor se escapa: el resultado es HTML seguro. */
export function interpolateHtml(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([\w-]+(?:\.[\w-]+)*)\}\}/g, (token, path: string) => {
    const value = resolveVariablePath(variables, path);
    if (value === null || value === undefined) return token;
    return escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value));
  });
}

const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "ul", "ol", "li", "a", "blockquote", "hr"]);
/** Etiquetas cuyo CONTENIDO tambien se descarta (no solo la etiqueta). */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "head", "title", "textarea", "select"]);
const VOID_TAGS = new Set(["br", "hr"]);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

/** Decodifica las entidades que se usan para disfrazar un protocolo (`jav&#x61;script:`). */
function decodeForCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&Tab;|&NewLine;/gi, "")
    .replace(/&amp;/gi, "&");
}

function safeHref(raw: string): string | null {
  const decoded = decodeForCheck(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!SAFE_HREF.test(decoded)) return null;
  return escapeHtml(decodeForCheck(raw).trim()).replace(/&amp;amp;/g, "&amp;");
}

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;

/**
 * Deja solo lo que un email necesita: parrafos, saltos, negrita, cursiva,
 * subrayado, titulos, listas, citas y links http(s)/mailto/tel. Todo atributo
 * se descarta salvo el `href` de un link (y se le pone `rel`/`target`).
 */
export function sanitizeEmailHtml(html: string): string {
  let out = "";
  let skipUntil: string | null = null;
  const open: string[] = [];

  for (const match of html.matchAll(TOKEN)) {
    const token = match[0];
    const name = match[1]?.toLowerCase();

    if (skipUntil) {
      if (name === skipUntil && token.startsWith("</")) skipUntil = null;
      continue;
    }
    if (token.startsWith("<!--")) continue;

    if (!name) {
      // Texto (o un "<" suelto): las entidades que ya venian se respetan.
      out += token === "<" ? "&lt;" : token.replace(/>/g, "&gt;");
      continue;
    }

    const closing = token.startsWith("</");
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !token.endsWith("/>")) skipUntil = name;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // se descarta la etiqueta, queda su texto

    if (closing) {
      if (VOID_TAGS.has(name)) continue;
      const at = open.lastIndexOf(name);
      if (at === -1) continue; // un cierre que nadie abrio
      // Cierra lo que haya quedado abierto adentro.
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }

    if (name === "a") {
      const href = safeHref(readAttr(match[2] ?? "", "href") ?? "");
      out += href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<a>";
      open.push("a");
    } else if (VOID_TAGS.has(name)) {
      out += `<${name}>`;
    } else {
      out += `<${name}>`;
      open.push(name);
    }
  }
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const TAG_STYLES: Record<string, string> = {
  p: "margin:0 0 16px;",
  h1: "margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;",
  h2: "margin:0 0 14px;font-size:20px;line-height:1.3;font-weight:700;",
  h3: "margin:0 0 12px;font-size:17px;line-height:1.3;font-weight:700;",
  ul: "margin:0 0 16px;padding-left:24px;",
  ol: "margin:0 0 16px;padding-left:24px;",
  li: "margin:0 0 6px;",
  blockquote: "margin:0 0 16px;padding-left:12px;border-left:3px solid #d1d5db;color:#4b5563;",
  a: "color:#2563eb;text-decoration:underline;",
  hr: "border:0;border-top:1px solid #e5e7eb;margin:20px 0;",
};

/** Estilos en linea para los clientes de correo. Solo se llama con la salida de `sanitizeEmailHtml`. */
export function inlineEmailStyles(safeHtml: string): string {
  const styled = safeHtml.replace(/<(p|h1|h2|h3|ul|ol|li|blockquote|a|hr)((?:\s[^>]*)?)>/g, (_, tag: string, attrs: string) => {
    return `<${tag}${attrs} style="${TAG_STYLES[tag]}">`;
  });
  return `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#111827;">${styled}</div>`;
}

/** El texto plano se vuelve HTML respetando los saltos de linea. */
export function plainTextToHtml(body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return inlineEmailStyles(paragraphs);
}

/** Lo que sale por el proveedor a partir de un cuerpo ya con las variables pegadas. */
export function finalizeEmailHtml(body: string, wasHtml: boolean): string {
  return wasHtml ? inlineEmailStyles(sanitizeEmailHtml(body)) : plainTextToHtml(body);
}
