/**
 * Troceo del documento en fragmentos indexables (F16).
 *
 * Que problema resuelve: la busqueda devuelve fragmentos, no documentos. Si el
 * fragmento es muy grande, el embedding promedia demasiados temas y deja de
 * distinguir; si es muy chico, pierde el contexto que lo hace entendible.
 *
 * Como corta: por parrafos, que es donde el autor ya puso los cortes. Solo se
 * parte un parrafo al medio si el parrafo solo se pasa del tamano, y ahi se
 * busca el final de oracion mas cercano.
 *
 * El solapamiento existe porque un corte siempre parte algo: si la respuesta a
 * una pregunta cae justo en el limite entre dos fragmentos, sin solapamiento
 * ninguno de los dos la contiene entera.
 *
 * Sin dependencias: es una funcion pura, que es como el repo prefiere las
 * validaciones y las reglas (ver lib/sequences/validate.ts).
 */

/** Tamano objetivo de un fragmento, en caracteres (~450 tokens). */
export const DEFAULT_CHUNK_SIZE = 1_800;

/** Cuanto se repite del fragmento anterior al empezar el siguiente. */
export const DEFAULT_OVERLAP = 200;

/**
 * Un fragmento mas corto que esto no se guarda solo.
 *
 * Evita el fragmento basura del final ("Pagina 12", una linea suelta): entra
 * un embedding en la base que no significa nada y que puede ganarle a uno bueno
 * en una busqueda corta.
 */
export const MIN_CHUNK_CHARS = 40;

export interface Chunk {
  index: number;
  content: string;
  /** Estimacion, ~4 caracteres por token. Solo sirve para armar los lotes. */
  tokenEstimate: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

/** Corta el markdown en fragmentos listos para indexar. */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = Math.max(options.chunkSize ?? DEFAULT_CHUNK_SIZE, 100);
  // El solapamiento nunca puede llegar al tamano del fragmento: si lo hiciera,
  // cada fragmento empezaria donde empezo el anterior y el troceo no avanzaria.
  const overlap = Math.min(Math.max(options.overlap ?? DEFAULT_OVERLAP, 0), Math.floor(chunkSize / 2));

  const text = markdown.trim();
  if (!text) return [];

  const pieces = splitIntoPieces(text, chunkSize);

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }

    if (current.length + 2 + piece.length <= chunkSize) {
      current = `${current}\n\n${piece}`;
      continue;
    }

    chunks.push(current);
    current = overlap > 0 ? withOverlap(current, piece, overlap) : piece;
  }

  if (current) chunks.push(current);

  return finalize(chunks);
}

/**
 * Los parrafos, con los que se pasan de largo ya partidos.
 *
 * Despues de esto ninguna pieza excede el tamano objetivo, asi que el armado de
 * fragmentos es solo juntar piezas.
 */
function splitIntoPieces(text: string, chunkSize: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      pieces.push(paragraph);
      continue;
    }
    pieces.push(...splitLongParagraph(paragraph, chunkSize));
  }

  return pieces;
}

/**
 * Parte un parrafo largo por final de oracion.
 *
 * Si ni siquiera hay un final de oracion donde cortar (una tabla, una lista sin
 * puntuacion, un texto en un idioma sin puntos), se corta por caracteres: es
 * feo, pero perder el fragmento seria peor.
 */
function splitLongParagraph(paragraph: string, chunkSize: number): string[] {
  const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > chunkSize) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += chunkSize) {
        pieces.push(sentence.slice(i, i + chunkSize));
      }
      continue;
    }

    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= chunkSize) {
      current = `${current} ${sentence}`;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * La cola del fragmento anterior, pegada al principio del siguiente.
 *
 * Se corta en el primer espacio para no arrancar a mitad de una palabra.
 */
function withOverlap(previous: string, next: string, overlap: number): string {
  if (previous.length <= overlap) return `${previous}\n\n${next}`;

  let tail = previous.slice(-overlap);
  const space = tail.search(/\s/);
  if (space > 0) tail = tail.slice(space + 1);

  return tail ? `${tail}\n\n${next}` : next;
}

/**
 * Numera los fragmentos y descarta los inservibles.
 *
 * Un ultimo fragmento demasiado corto se pega al anterior en vez de tirarse:
 * puede ser el final de una frase que importa.
 */
function finalize(raw: string[]): Chunk[] {
  const cleaned = raw.map((c) => c.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  const merged: string[] = [];

  for (const chunk of cleaned) {
    if (chunk.length < MIN_CHUNK_CHARS && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${chunk}`;
      continue;
    }
    merged.push(chunk);
  }

  // Un documento entero mas corto que el minimo se indexa igual: es corto, pero
  // es todo lo que hay, y no indexarlo seria perderlo.
  return merged.map((content, index) => ({
    index,
    content,
    tokenEstimate: Math.ceil(content.length / 4),
  }));
}
