/**
 * Topes de texto por canal, contados como los cuenta cada proveedor.
 *
 * Un emoji NO es un caracter: "👨‍👩‍👧" son 8 unidades de UTF-16 y 18 bytes pero
 * una sola cosa para quien lo lee. Cada proveedor cuenta distinto:
 *
 *   - WhatsApp (Evolution): 4096 caracteres (unidades UTF-16, como `String.length`).
 *   - Instagram (Zernio): la API de mensajes acepta hasta 1000 BYTES UTF-8 de texto.
 *     Un emoji pesa 4 bytes (los compuestos, mas), asi que con emojis el tope real
 *     es mucho menor que 1000 "letras".
 *   - Email (Resend): el asunto se recomienda de hasta 78 caracteres (el estandar
 *     admite 998). El cuerpo no tiene un tope practico para nosotros.
 *
 * Puro. Lo usa el composer para avisar ANTES de mandar, y los tests fijan que un
 * emoji compuesto no se parta ni se cuente de menos.
 */

export type TextLimitKind = "bytes" | "utf16";

export interface TextLimit {
  max: number;
  kind: TextLimitKind;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Cuenta grafemas (lo que ve una persona). Cae a puntos de codigo sin `Intl.Segmenter`. */
export function graphemeCount(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg) {
    let n = 0;
    for (const _ of new Seg(undefined, { granularity: "grapheme" }).segment(text)) {
      void _;
      n += 1;
    }
    return n;
  }
  return Array.from(text).length;
}

/** El tope del TEXTO de un mensaje en este canal, o null si no hay uno que importe. */
export function messageTextLimit(provider: string | null | undefined): TextLimit | null {
  switch (provider) {
    case "evolution":
      return { max: 4096, kind: "utf16" };
    case "zernio":
      return { max: 1000, kind: "bytes" };
    case "resend":
      return null;
    default:
      return null;
  }
}

/** El tope del asunto de un email (recomendado). */
export const EMAIL_SUBJECT_LIMIT: TextLimit = { max: 78, kind: "utf16" };

export function measure(text: string, limit: TextLimit): number {
  return limit.kind === "bytes" ? byteLength(text) : text.length;
}

export interface LimitCheck {
  ok: boolean;
  used: number;
  max: number;
  kind: TextLimitKind;
}

/** Si el texto entra en el tope. Sin tope, siempre entra. */
export function checkTextLimit(text: string, limit: TextLimit | null): LimitCheck {
  if (!limit) return { ok: true, used: text.length, max: Infinity, kind: "utf16" };
  const used = measure(text, limit);
  return { ok: used <= limit.max, used, max: limit.max, kind: limit.kind };
}

/** El mensaje que ve la persona cuando se pasa. */
export function limitMessage(check: LimitCheck): string | null {
  if (check.ok) return null;
  const unit = check.kind === "bytes" ? "bytes (cada emoji pesa 4 o mas)" : "caracteres";
  return `El mensaje es muy largo para este canal: ${check.used} de ${check.max} ${unit}.`;
}
