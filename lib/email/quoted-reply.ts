/**
 * Separar lo que una persona escribió de lo que su correo citó al responder. PURO: lo usan el receptor y la burbuja.
 *
 * Importa más de lo que parece: una respuesta a un email de marketing cita el pie («Darme de baja»), y la regla de baja
 * lo tomaba como un pedido de la persona. También ensuciaba la vista previa de la lista y los patrones de mensajes.
 *
 * Es conservadora: corta solo si TODO lo que sigue es cita. Una respuesta intercalada entre citas, o un correo que es
 * solo cita, quedan enteros (perder lo que escribió alguien es peor que mostrar una cita de más).
 */

export interface SplitReply {
  reply: string;
  quoted: string | null;
}

const QUOTE_LINE = /^\s*>/;
/** Cuántas líneas puede ocupar el encabezado de la cita: Gmail lo parte cuando es largo. */
const ATTRIBUTION_MAX_LINES = 4;
const ATTRIBUTION_START = /^\s*(El|On|Em|Le|Am)\s/i;
const ATTRIBUTION_END = /(escribi[oó]|wrote|escreveu|a [ée]crit|schrieb)\s*:\s*$/i;
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*(mensaje original|original message|mensagem original|message d'origine)\s*-{2,}\s*$/i;
const HEADER_FROM = /^\s*\*?(de|from)\*?:\s/i;
const HEADER_SENT = /^\s*\*?(enviado|enviada|sent|date|fecha)\*?:\s/i;
const HEADER_SUBJECT = /^\s*\*?(asunto|subject)\*?:\s/i;

/** Dónde termina el encabezado «El … escribió:» que arranca en `start`, o -1 si no es uno. */
function attributionEnd(lines: readonly string[], start: number): number {
  if (!ATTRIBUTION_START.test(lines[start])) return -1;
  for (let i = start; i < Math.min(start + ATTRIBUTION_MAX_LINES, lines.length); i++) {
    if (i > start && !lines[i].trim()) return -1;
    if (ATTRIBUTION_END.test(lines[i])) return i;
  }
  return -1;
}

/** Los encabezados de Outlook (De / Enviado / Asunto), que no marcan la cita con `>`. */
function isHeaderBlock(lines: readonly string[], start: number): boolean {
  if (!HEADER_FROM.test(lines[start])) return false;
  const block = lines.slice(start + 1, start + 6);
  return block.some((l) => HEADER_SENT.test(l)) && block.some((l) => HEADER_SUBJECT.test(l));
}

/** Lo que sigue a un encabezado: todo citado, nada marcado (un correo pasado de HTML a texto pierde los `>`) o mezclado (intercalado). */
function restKind(lines: readonly string[], from: number): "all" | "none" | "mixed" {
  const rest = lines.slice(from).filter((l) => l.trim());
  const marked = rest.filter((l) => QUOTE_LINE.test(l)).length;
  if (marked === 0) return "none";
  return marked === rest.length ? "all" : "mixed";
}

/** Sin `>` hace falta más certeza: «El dueño me escribió:» es algo que alguien puede escribir; con una dirección o un año, no. */
function looksLikeRealAttribution(lines: readonly string[], start: number, end: number): boolean {
  return /@|\b\d{4}\b/.test(lines.slice(start, end + 1).join(" "));
}

function result(lines: readonly string[], cut: number, whole: string): SplitReply {
  const reply = lines.slice(0, cut).join("\n").trim();
  // Solo cita: se deja entero, para no guardar un mensaje vacío.
  if (!reply) return { reply: whole, quoted: null };
  return { reply, quoted: lines.slice(cut).join("\n").trim() || null };
}

export function splitQuotedReply(text: string | null | undefined): SplitReply {
  const whole = (text ?? "").trim();
  if (!whole) return { reply: "", quoted: null };
  const lines = whole.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const end = attributionEnd(lines, i);
    if (end !== -1) {
      const kind = restKind(lines, end + 1);
      if (kind === "all" || (kind === "none" && looksLikeRealAttribution(lines, i, end))) return result(lines, i, whole);
      if (kind === "mixed") return { reply: whole, quoted: null };
    }
    if (ORIGINAL_MESSAGE.test(lines[i]) || isHeaderBlock(lines, i)) return result(lines, i, whole);
    if (QUOTE_LINE.test(lines[i])) {
      if (lines.slice(i).every((l) => !l.trim() || QUOTE_LINE.test(l))) return result(lines, i, whole);
      return { reply: whole, quoted: null };
    }
  }
  return { reply: whole, quoted: null };
}

/**
 * Lo que escribió la persona, sin ninguna línea citada, también en una respuesta intercalada. Es lo que mira la regla
 * de baja: en ese caso `reply` conserva las citas para mostrarlas, pero una cita nunca es un pedido.
 */
export function withoutQuotedLines(text: string | null | undefined): string {
  return (text ?? "")
    .split(/\r?\n/)
    .filter((l) => !QUOTE_LINE.test(l))
    .join("\n")
    .trim();
}

/** La cita para leerla: sin los `>` de adelante. */
export function readableQuote(quoted: string): string {
  return quoted
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(>\s?)+/, ""))
    .join("\n")
    .trim();
}

/**
 * Qué muestra la burbuja de un email entrante. Un mensaje nuevo ya viene separado (`email_quoted_text`); uno guardado
 * antes de la 00289 se separa al dibujarlo, sin tocar la base.
 */
export function emailBubbleParts(message: { text?: string | null; email_quoted_text?: string | null }): SplitReply {
  if (message.email_quoted_text) return { reply: (message.text ?? "").trim(), quoted: message.email_quoted_text };
  return splitQuotedReply(message.text);
}
