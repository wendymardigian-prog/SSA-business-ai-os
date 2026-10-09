/**
 * Insertar un recurso de la banca en un texto (el email o el mensaje de una
 * automatizacion).
 *
 * Solo entran los dos tipos que SON texto: un texto (se inserta su contenido,
 * con sus variables, que se resuelven al enviar: ver `bank-variables.ts`) y un
 * enlace (se inserta la direccion). Un audio, un video, una imagen o un
 * archivo no se pueden meter en un texto: para eso esta "Enviar recurso".
 *
 * Puro.
 */

import type { AssetKind } from "@/lib/response-assets/kind";

export interface InsertableAsset {
  kind: AssetKind | string;
  content: string | null;
  url: string | null;
}

export function isInsertableKind(kind: string): boolean {
  return kind === "text" || kind === "link";
}

/** Lo que se inserta, o null si el recurso no es texto o esta vacio. */
export function insertableText(asset: InsertableAsset): string | null {
  if (asset.kind === "text") return (asset.content ?? "").trim() || null;
  if (asset.kind === "link") return (asset.url ?? "").trim() || null;
  return null;
}

/**
 * Mete `snippet` en `value` donde esta el cursor (reemplazando la seleccion).
 * Devuelve el texto nuevo y donde queda el cursor: justo despues de lo
 * insertado. Un cursor fuera de rango (un campo que nunca tuvo foco) inserta
 * al final.
 */
export function insertAtCursor(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  snippet: string,
): { value: string; caret: number } {
  const clamp = (n: number | null | undefined) =>
    typeof n === "number" && n >= 0 && n <= value.length ? n : value.length;
  const start = clamp(selectionStart);
  const end = Math.max(start, clamp(selectionEnd));
  return { value: value.slice(0, start) + snippet + value.slice(end), caret: start + snippet.length };
}
