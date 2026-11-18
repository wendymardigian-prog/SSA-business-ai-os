// @plantilla-quitar(servicios)
/**
 * El texto de una publicación de la comunidad, puro. Se GUARDA en Markdown acotado (`community_posts.body`), el MISMO
 * lector del contrato (`lib/forms/contract/markdown.ts`): títulos (#, ##, ###), **negrita**, *cursiva*, listas (- y
 * 1.), links [texto](https://…) y párrafos; un salto de línea suelto es un salto de línea. Nada de HTML: todo lo demás
 * queda como texto literal, y React lo escapa al dibujar.
 *
 * Además de lo que dice el Markdown:
 *  - un link pegado suelto (https://…) también es link (los posts de texto plano de antes y los del portal);
 *  - los links de video (YouTube, Vimeo, Loom, Drive y Fathom compartido) se ven con su reproductor debajo del texto,
 *    con el mismo reconocedor que las clases (`normalizeVideoUrl`);
 *  - los renglones vacíos se guardan (18/11/2026): entre dos bloques, cada par de saltos de línea DE MÁS es un párrafo
 *    vacío (`a\n\n\n\nb` = «a», un renglón vacío, «b»). Con dos o tres saltos, como siempre: párrafos seguidos. Es un
 *    párrafo sin texto (`runs: []`), que la pantalla, el portal y el correo dibujan como un renglón en blanco.
 *
 * El portal (otro repositorio) lee lo mismo: `community-text.cases.json` son los casos que corren las dos copias.
 */
import { renderContractMarkdown, safeHref, type ContractBlock, type InlineRun } from "@/lib/forms/contract/markdown";
import { markdownToEditorDoc, editorDocToMarkdown, type DocNode } from "@/lib/forms/contract/editor-markdown";
import { normalizeVideoUrl, type VideoProvider } from "@/lib/program/video-url";

export type CommunityBlock = ContractBlock;
export type CommunityRun = InlineRun;

/** Un link suelto: empieza con http(s):// y termina antes de un espacio o de la puntuación que lo cierra. */
const BARE_URL = /https?:\/\/[^\s<>"'()[\]]+[^\s<>"'()[\].,;:!?»”’]/g;

/** Parte un tramo SIN link donde hay una dirección suelta. Con link (o sin direcciones), queda igual. */
function linkifyRun(run: InlineRun): InlineRun[] {
  if (run.href) return [run];
  const out: InlineRun[] = [];
  let last = 0;
  for (const m of run.text.matchAll(BARE_URL)) {
    const at = m.index ?? 0;
    const href = safeHref(m[0]);
    if (!href) continue;
    if (at > last) out.push({ ...run, text: run.text.slice(last, at) });
    out.push({ ...run, text: m[0], href });
    last = at + m[0].length;
  }
  if (last === 0) return [run];
  if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) });
  return out;
}

const linkify = (runs: InlineRun[]) => runs.flatMap(linkifyRun);

/** Un tramo de texto o un renglón vacío. */
type Piece = { text: string } | { blank: true };

/**
 * Corta el texto donde hay cuatro o más saltos de línea seguidos: cada par de más (después de los dos que separan
 * párrafos) es un renglón vacío. Lo que queda entre esos cortes se lee como siempre. Los del principio y el final no
 * cuentan.
 */
export function splitBlankLines(body: string): Piece[] {
  const text = (body ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(/\n{4,}/g)) {
    const at = m.index ?? 0;
    out.push({ text: text.slice(last, at) });
    for (let i = 0; i < Math.floor((m[0].length - 2) / 2); i++) out.push({ blank: true });
    last = at + m[0].length;
  }
  out.push({ text: text.slice(last) });
  return out;
}

/** Los bloques para dibujar una publicación. Un renglón vacío es un párrafo sin texto. */
export function communityBlocks(body: string): CommunityBlock[] {
  return splitBlankLines(body).flatMap((piece): CommunityBlock[] =>
    "blank" in piece
      ? [{ type: "paragraph", runs: [] }]
      : renderContractMarkdown(piece.text).map((b) =>
          b.type === "list" ? { ...b, items: b.items.map(linkify) } : { ...b, runs: linkify(b.runs) },
        ),
  );
}

/** Todas las direcciones de un texto (las de los links y las sueltas), en orden y sin repetir. */
export function communityLinks(body: string): string[] {
  const seen = new Set<string>();
  for (const block of communityBlocks(body)) {
    const runs = block.type === "list" ? block.items.flat() : block.runs;
    for (const r of runs) if (r.href) seen.add(r.href);
  }
  return [...seen];
}

export interface CommunityVideo {
  url: string;
  provider: VideoProvider;
  embedUrl: string;
}

/** Hasta cuántos reproductores se muestran debajo de un post. */
export const MAX_VIDEOS = 4;

/** Los videos que se ven debajo del texto: los links que se pueden incrustar, sin repetir el mismo video. */
export function communityVideos(body: string): CommunityVideo[] {
  const out: CommunityVideo[] = [];
  for (const url of communityLinks(body)) {
    if (!/^https:\/\//i.test(url)) continue;
    const v = normalizeVideoUrl(url);
    if (!v.ok || !v.embedUrl || out.some((x) => x.embedUrl === v.embedUrl)) continue;
    out.push({ url, provider: v.provider, embedUrl: v.embedUrl });
    if (out.length >= MAX_VIDEOS) break;
  }
  return out;
}

/** El texto plano (para buscar, o un resumen). */
export function communityPlainText(body: string): string {
  return communityBlocks(body)
    .map((b) => (b.type === "list" ? b.items.map((i) => i.map((r) => r.text).join("")).join("\n") : b.runs.map((r) => r.text).join("")))
    .join("\n");
}

// ---------------------------------------------------------------------------
// El editor con formato (Tiptap) ↔ lo que se guarda
// ---------------------------------------------------------------------------

/** Lo guardado → el documento del editor (un renglón vacío vuelve a ser un párrafo vacío). */
export function communityToEditorDoc(body: string): DocNode {
  const content: DocNode[] = [];
  for (const piece of splitBlankLines(body)) {
    if ("blank" in piece) content.push({ type: "paragraph" });
    else if (piece.text.trim()) content.push(...(markdownToEditorDoc(piece.text).content ?? []).filter((n) => !isEmptyParagraph(n)));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const isEmptyParagraph = (node: DocNode) => node.type === "paragraph" && !(node.content ?? []).some((c) => c.type !== "hardBreak" && !(c.type === "text" && !c.text?.trim()));

/**
 * El documento del editor → lo que se guarda. Un párrafo vacío ENTRE dos bloques con texto es un renglón vacío (se
 * guarda como dos saltos de línea de más); los vacíos del principio y el final se descartan.
 */
export function communityFromEditorDoc(doc: DocNode): string {
  const parts: string[] = [];
  for (const node of doc.content ?? []) {
    const md = editorDocToMarkdown({ type: "doc", content: [node] });
    if (md.trim()) parts.push(md);
    else if (isEmptyParagraph(node)) parts.push("");
  }
  while (parts.length && parts[0] === "") parts.shift();
  while (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts.join("\n\n").trim();
}

/**
 * Un texto pegado que ya viene en Markdown (de Claude, de ChatGPT, de Notion como texto) se abre con su formato; uno
 * sin marcas de Markdown se pega como siempre. Devuelve null cuando no hay nada que interpretar.
 */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,3}\s|[-*]\s|\d+[.)]\s)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((https?:|mailto:|tel:)/.test(text);
}

/** El título de un post del equipo (00405): obligatorio en uno nuevo, hasta 200 caracteres (emojis incluidos). */
export const COMMUNITY_TITLE_MAX = 200;

// ---------------------------------------------------------------------------
// Fotos del equipo
// ---------------------------------------------------------------------------

export const COMMUNITY_MEDIA_BUCKET = "community-media";
export const MAX_COMMUNITY_PHOTOS = 10;
export const COMMUNITY_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** Dónde se guarda una foto que sube el equipo. La base (00401) solo acepta este molde. */
export function teamMediaPath(input: { workspaceId: string; productId: string; fileId: string; ext: string }): string {
  return `${input.workspaceId}/${input.productId}/team/${input.fileId}.${input.ext}`;
}

/** Las fotos de un post (`media` de la base): solo los objetos con un path de texto. */
export function mediaPaths(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => (m && typeof m === "object" && typeof (m as { path?: unknown }).path === "string" ? (m as { path: string }).path : null))
    .filter((p): p is string => !!p)
    .slice(0, MAX_COMMUNITY_PHOTOS);
}
