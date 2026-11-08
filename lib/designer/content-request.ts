/**
 * El pedido a la IA al diseñar desde una pieza de Contenido (DS8, F62): puro y con su test.
 *
 * De una pieza (guion, caption, pilar, oferta, etapa) y la red para la que se diseña sale: el formato del diseño (F61),
 * cuántas páginas, el texto del pedido y el contexto que la IA recibe (`ContentAiContext`). En un carrusel cada parte del
 * guion es una página; el guion llega entero al contexto y, parte por parte, al pedido. Una pieza con un guion de 5
 * partes y la red Instagram Carrusel da un diseño v45 de 5 páginas.
 *
 * También arma el texto de un diseño para que el copywriter proponga el caption «a partir del diseño» (F63).
 */

import { funnelStageInfo } from "@/lib/content/classification";
import { contentTarget, designFormatFor, targetsForPlatform, type ContentTarget } from "./content-map";
import type { ContentAiContext } from "./contracts";
import type { DesignDoc } from "./doc/schema";
import { FORMATS, MAX_PAGES, type FormatKey } from "./formats";
import { PLACEHOLDER_TEXT } from "./screens/starter-docs";

/** Lo de la pieza que la IA necesita, ya con los nombres (no los ids). */
export interface PieceBrief {
  postId: string;
  title: string;
  script: string | null;
  caption: string | null;
  /** El nombre del pilar y de la oferta, si los tiene. */
  pillar: string | null;
  offer: string | null;
  /** `tofu`, `mofu` o `bofu`. */
  funnelStage: string | null;
}

/** El tope de cada parte del guion que viaja a la IA (un guion enorme no tiene por qué llenar el pedido). */
export const MAX_PART_CHARS = 2000;
/** El tope del texto del pedido (el de `submitRequest` es 4000). */
const MAX_PROMPT_CHARS = 3800;
/** Lo que se cuenta de cada parte dentro del pedido, para que entren todas. */
const PROMPT_PART_CHARS = 400;

/** Las partes de un guion: los párrafos, separados por una línea en blanco. Sin guion, ninguna. */
export function scriptParts(script: string | null | undefined): string[] {
  return (script ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * La publicación para la que se diseña cuando la pieza no dice una: la que ya tiene la red si se arma con un diseño; si
 * no, una de varias páginas cuando el guion tiene varias partes y una de una página cuando no.
 */
export function pickTargetForPiece(params: { platform: string; existingFormat?: string | null; parts: number }): ContentTarget | null {
  const existing = contentTarget(params.platform, params.existingFormat ?? null);
  if (existing) return existing;
  const candidates = targetsForPlatform(params.platform);
  if (candidates.length === 0) return null;
  const wantsMany = params.parts > 1;
  return candidates.find((t) => t.multiPage === wantsMany) ?? candidates[0];
}

export type PieceRequest =
  | {
      ok: true;
      target: ContentTarget;
      format: FormatKey;
      multiPage: boolean;
      /** Cuántas páginas pide el diseño; null = que decida la IA (no hay guion). */
      pages: number | null;
      /** El nombre del diseño. */
      name: string;
      /** El texto del pedido a la IA. */
      prompt: string;
      /** Lo que la IA recibe de la pieza. */
      contentContext: ContentAiContext;
    }
  | { ok: false; error: string };

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** El pedido a la IA para diseñar la pieza en una red (F62). */
export function buildPieceRequest(params: { piece: PieceBrief; platform: string; existingFormat?: string | null; preferredFormat?: FormatKey | null }): PieceRequest {
  const parts = scriptParts(params.piece.script).map((part) => clip(part, MAX_PART_CHARS));
  const target = pickTargetForPiece({ platform: params.platform, existingFormat: params.existingFormat, parts: parts.length });
  if (!target) return { ok: false, error: "Esa red no se arma con un diseño. Elegí otra." };

  const { format, multiPage } = designFormatFor(target, params.preferredFormat);
  const formatDef = FORMATS[format];

  let pages: number | null;
  if (!multiPage) pages = 1;
  else if (parts.length === 0) pages = null;
  else pages = Math.min(MAX_PAGES, Math.max(parts.length, target.output === "png" ? target.files.min : 1));

  const lines: string[] = [`Diseñá la pieza «${params.piece.title.trim() || "Sin título"}» para ${target.label}.`, `Formato: ${formatDef.label} (${formatDef.width}×${formatDef.height}).`];

  if (!multiPage) {
    lines.push(parts.length > 0 ? "Una sola página con el mensaje principal del guion." : "Una sola página con el mensaje principal de la pieza.");
  } else if (parts.length === 0 || pages === null) {
    lines.push("Todavía no hay guion: proponé un carrusel de entre 3 y 7 páginas a partir del título y del caption.");
  } else {
    const perPart = Math.max(120, Math.min(PROMPT_PART_CHARS, Math.floor(2800 / parts.length)));
    lines.push(`El guion tiene ${parts.length} ${parts.length === 1 ? "parte" : "partes"}: armá ${pages} ${pages === 1 ? "página" : "páginas"}, una por cada parte, en este orden.`);
    parts.slice(0, MAX_PAGES).forEach((part, i) => lines.push(`Página ${i + 1}: ${clip(part, perPart)}`));
    if (parts.length > MAX_PAGES) lines.push(`Las partes ${MAX_PAGES + 1} a ${parts.length} se resumen en la última página.`);
    if (pages > parts.length) lines.push(`Completá hasta ${pages} páginas con una portada y un cierre.`);
  }
  if (params.piece.caption?.trim()) lines.push("El caption de la pieza va en el contexto: no lo copies en el diseño, usalo para el tono.");

  return {
    ok: true,
    target,
    format,
    multiPage,
    pages,
    name: clip(`${params.piece.title.trim() || "Pieza"} · ${target.label}`, 200),
    prompt: clip(lines.join("\n"), MAX_PROMPT_CHARS),
    contentContext: {
      postId: params.piece.postId,
      network: target.label,
      script: parts,
      caption: params.piece.caption?.trim() ? clip(params.piece.caption.trim(), 2000) : null,
      pillar: params.piece.pillar,
      offer: params.piece.offer,
      funnelStage: funnelStageInfo(params.piece.funnelStage)?.label ?? null,
    },
  };
}

/**
 * El texto de cada página de un diseño (de arriba hacia abajo), para que el copywriter proponga el caption «a partir del
 * diseño». Una página sin texto no cuenta. Sin variables ni marcas: texto plano.
 */
export function designTextParts(doc: DesignDoc): string[] {
  return doc.pages
    .map((page) =>
      page.elements
        .flatMap((el) => (el.type === "text" ? [{ y: el.y, x: el.x, text: el.text.replace(/\{\{[^{}]*\}\}/g, "").replace(/\s+/g, " ").trim() }] : []))
        .filter((t) => t.text !== "" && t.text !== PLACEHOLDER_TEXT)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((t) => t.text)
        .join("\n"),
    )
    .filter((text) => text !== "");
}
