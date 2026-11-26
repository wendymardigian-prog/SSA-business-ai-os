/**
 * Encuentra los tooltips del navegador (`title=` en un elemento) en el codigo de una pantalla. Puro: recibe el texto
 * de un archivo .tsx y devuelve donde hay uno. Lo usa `lib/ui/no-native-title.test.ts`.
 *
 * Un `title=` cuenta si esta adentro de la etiqueta de apertura de un elemento HTML (`<span title=…>`, nombre en
 * minuscula) o de un `<Link>`, que lo pasa al `<a>`. No cuentan:
 *   - `iframe`: su `title` es su nombre accesible, no un tooltip;
 *   - `<title>` (de un SVG) ni las props `title` de componentes propios (`<Section title=…>`, `<Card title=…>`).
 *
 * Para encontrar la etiqueta camina hacia atras desde el `title=` contando llaves: un `>` adentro de una expresion
 * (`{(a) => b}`) no cierra la etiqueta.
 */

const ALLOWED_TAGS = new Set(["iframe", "title"]);

export interface NativeTitleHit {
  line: number;
  tag: string;
}

/** La etiqueta JSX (abierta) que contiene la posicion `at`, o null si `at` no esta dentro de una etiqueta. */
function enclosingTag(source: string, at: number): string | null {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return null; // el title= esta adentro de una expresion, no en una etiqueta
      depth--;
    } else if (depth === 0 && ch === ">") {
      if (source[i - 1] === "=") continue; // flecha `=>`
      return null;
    } else if (depth === 0 && ch === "<") {
      const match = /^<([A-Za-z][\w.]*)/.exec(source.slice(i, i + 64));
      return match ? match[1] : null;
    }
  }
  return null;
}

export function findNativeTitles(source: string): NativeTitleHit[] {
  const hits: NativeTitleHit[] = [];
  const re = /(?<=\s)title=/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const tag = enclosingTag(source, match.index);
    if (!tag) continue;
    const isHtml = /^[a-z]/.test(tag) && !tag.includes(".");
    if (!(isHtml || tag === "Link")) continue;
    if (ALLOWED_TAGS.has(tag)) continue;
    hits.push({ line: source.slice(0, match.index).split("\n").length, tag });
  }
  return hits;
}
