import type { OutputFormat } from "./schemas";

/**
 * Validacion del formato de salida, EN CODIGO, antes de enviar (F22).
 *
 * Pedirle al modelo "maximo 600 caracteres, sin emojis" en el prompt no
 * alcanza: a veces no lo cumple, y lo que llega al lead es lo que se envia, no
 * lo que se pidio. Esto es lo que garantiza el formato.
 *
 * Funcion pura, sin base ni red: es lo que se testea.
 */

export type OutputValidation =
  | { ok: true; parts: string[]; truncated: boolean }
  | { ok: false; reason: "empty" | "injection_echo" };

// Extended_Pictographic cubre los emojis; el resto son los modificadores y
// uniones que quedan colgados cuando se saca el emoji base.
const EMOJI = /\p{Extended_Pictographic}|‍|️|[\u{1f3fb}-\u{1f3ff}]/gu;

/** Restos del armado del prompt que nunca pueden llegar al lead. */
const LEAK_MARKERS = [/<<<\s*(lead|dato|conocimiento|crm|memoria|fin)/i, /"toolCallId"\s*:/i];

export function stripEmojis(text: string): string {
  return text.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/**
 * Corta en el ultimo final de oracion antes del tope; si no hay, en el ultimo
 * espacio; si no hay, al tope. Nunca a mitad de palabra si se puede evitar.
 */
export function cutAtBoundary(text: string, max: number): { head: string; rest: string } {
  if (text.length <= max) return { head: text, rest: "" };
  const window = text.slice(0, max + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("\n"),
  );
  let cut = sentenceEnd >= max * 0.4 ? sentenceEnd + 1 : -1;
  if (cut <= 0) {
    const space = window.lastIndexOf(" ");
    cut = space >= max * 0.4 ? space : max;
  }
  return { head: text.slice(0, cut).trim(), rest: text.slice(cut).trim() };
}

export function validateOutput(raw: string, format: OutputFormat): OutputValidation {
  let text = (raw ?? "").trim();
  if (LEAK_MARKERS.some((marker) => marker.test(text))) {
    return { ok: false, reason: "injection_echo" };
  }
  if (!format.emojis) text = stripEmojis(text);
  if (!text) return { ok: false, reason: "empty" };

  const maxParts = format.allowSplit ? format.maxParts : 1;
  const parts: string[] = [];
  let rest = text;
  let truncated = false;

  while (rest && parts.length < maxParts) {
    const { head, rest: remaining } = cutAtBoundary(rest, format.maxLength);
    if (head) parts.push(head);
    rest = remaining;
  }
  if (rest) truncated = true;

  if (parts.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, parts, truncated };
}
