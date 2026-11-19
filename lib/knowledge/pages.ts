/**
 * Páginas y citas de la base de conocimientos. Puro.
 *
 *  - La extracción del PDF deja una marca `<!-- pagina N -->` al principio de cada página.
 *  - `pagesForChunks` dice en qué página empieza cada trozo: la de la marca con la que arranca, o la última
 *    marca vista en los trozos anteriores. Sin ninguna marca en el documento, todas en null (sin páginas).
 *  - `appendCitations` asegura que la respuesta del agente lleve la cita del documento y la página de lo que usó:
 *    si el modelo ya nombró el documento, no se repite.
 */

const PAGE_MARK = /<!--\s*pagina\s+(\d+)\s*-->/gi;

function marks(content: string): number[] {
  const out: number[] = [];
  for (const m of content.matchAll(PAGE_MARK)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

/** Lo que hay antes de la primera marca, sin separadores ni espacios. */
function leadingText(content: string): string {
  const idx = content.search(/<!--\s*pagina\s+\d+\s*-->/i);
  const head = idx < 0 ? content : content.slice(0, idx);
  return head.replace(/-{3,}/g, "").trim();
}

export function pagesForChunks(contents: string[]): Array<number | null> {
  const all = contents.map(marks);
  if (all.every((m) => m.length === 0)) return contents.map(() => null);
  let current: number | null = null;
  return contents.map((content, i) => {
    const own = all[i];
    // Arranca con una marca (sin texto antes): esa es su página. Si no, sigue la del trozo anterior.
    const start = own.length > 0 && leadingText(content) === "" ? own[0] : (current ?? (own.length > 0 ? Math.max(1, own[0] - 1) : 1));
    if (own.length > 0) current = own[own.length - 1];
    else if (current === null) current = start;
    return start;
  });
}

export interface Citation {
  document: string;
  page: number | null;
}

/** «Título», pág. 3 · «Título», págs. 2 y 5 · «Título» (sin páginas). */
export function citationLabel(document: string, pages: Array<number | null>): string {
  const nums = [...new Set(pages.filter((p): p is number => typeof p === "number"))].sort((a, b) => a - b);
  const title = `«${document.trim() || "Documento"}»`;
  if (nums.length === 0) return title;
  if (nums.length === 1) return `${title}, pág. ${nums[0]}`;
  return `${title}, págs. ${nums.slice(0, -1).join(", ")} y ${nums[nums.length - 1]}`;
}

/** Las citas agrupadas por documento, en el orden en que aparecieron. Máximo `max` documentos. */
export function groupCitations(citations: Citation[], max = 3): string[] {
  const byDoc = new Map<string, Array<number | null>>();
  for (const c of citations) {
    const key = c.document.trim() || "Documento";
    byDoc.set(key, [...(byDoc.get(key) ?? []), c.page]);
  }
  return [...byDoc.entries()].slice(0, max).map(([doc, pages]) => citationLabel(doc, pages));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Agrega «Fuente: …» al final de la respuesta con los documentos usados que el modelo no nombró.
 * Sin citas, o si ya las nombró todas, devuelve las partes tal cual.
 */
export function appendCitations(parts: string[], citations: Citation[], max = 3): string[] {
  if (parts.length === 0 || citations.length === 0) return parts;
  const text = fold(parts.join("\n"));
  const missing = citations.filter((c) => {
    const doc = fold(c.document.trim());
    if (!doc || !text.includes(doc)) return true;
    // Nombró el documento pero no la página que usó: también falta.
    return typeof c.page === "number" && !new RegExp(`pag[a-z.]*\\s*${c.page}\\b`).test(text);
  });
  if (missing.length === 0) return parts;
  const line = `Fuente: ${groupCitations(missing, max).join("; ")}.`;
  const out = [...parts];
  out[out.length - 1] = `${out[out.length - 1]}\n\n${line}`;
  return out;
}
