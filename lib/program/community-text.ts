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
 *    con el mismo reconocedor que las clases (`normalizeVideoUrl`).
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

/** Los bloques para dibujar una publicación. */
export function communityBlocks(body: string): CommunityBlock[] {
  return renderContractMarkdown(body ?? "").map((b) =>
    b.type === "list" ? { ...b, items: b.items.map(linkify) } : { ...b, runs: linkify(b.runs) },
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

/** Lo guardado → el documento del editor. */
export function communityToEditorDoc(body: string): DocNode {
  return markdownToEditorDoc(body ?? "");
}

/** El documento del editor → lo que se guarda. */
export function communityFromEditorDoc(doc: DocNode): string {
  return editorDocToMarkdown(doc).trim();
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
