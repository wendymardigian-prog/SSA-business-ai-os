/**
 * Menciones de un comentario (F132). Puro: lo usan el cuadro de escribir y la acción del servidor.
 *
 * El cuadro inserta `@Nombre` al elegir a alguien de la lista y guarda su id aparte. Al mandar, quedan solo las
 * personas cuyo `@Nombre` sigue en el texto (si la persona lo borró a mano, ya no la mencionás). La base vuelve a
 * filtrar: solo quedan las que ven la entidad (`comment_filter_mentions`), así que esto es comodidad, no seguridad.
 */

export const MAX_MENTIONS = 20;
export const MAX_COMMENT_LENGTH = 5000;

export type MentionCandidate = { id: string; name: string };

/** El texto que se inserta en el cuadro al elegir a una persona. */
export function mentionToken(name: string): string {
  return `@${name.trim().replace(/\s+/g, " ")}`;
}

/** Las menciones que siguen en el texto, sin repetir, sin quien escribe y con el tope. */
export function mentionsInBody(body: string, picked: readonly MentionCandidate[], authorId?: string | null): string[] {
  const out: string[] = [];
  for (const c of picked) {
    if (!c.id || c.id === authorId || out.includes(c.id)) continue;
    if (!body.includes(mentionToken(c.name))) continue;
    out.push(c.id);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/**
 * La palabra que se está escribiendo después de un `@` (para filtrar la lista), o null si el cursor no está en
 * una mención. `@` tiene que ir al principio o después de un espacio (un email no abre la lista).
 */
export function activeMentionQuery(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query) || query.length > 40) return null;
  return { query, start: at };
}

/** Los candidatos que coinciden con lo escrito (sin acentos ni mayúsculas), hasta 8. */
export function filterCandidates(candidates: readonly MentionCandidate[], query: string, selfId?: string | null): MentionCandidate[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  return candidates
    .filter((c) => c.id !== selfId && (q === "" || norm(c.name).split(/\s+/).some((w) => w.startsWith(q)) || norm(c.name).startsWith(q)))
    .slice(0, 8);
}

/** Inserta la mención reemplazando lo escrito desde el `@`. Devuelve el texto y dónde queda el cursor. */
export function insertMention(text: string, start: number, cursor: number, c: MentionCandidate): { text: string; cursor: number } {
  const token = `${mentionToken(c.name)} `;
  const next = text.slice(0, start) + token + text.slice(cursor);
  return { text: next, cursor: start + token.length };
}

/** El cuerpo listo para mandar, o el motivo en palabras. */
export function commentBodyProblem(body: string): string | null {
  const t = body.trim();
  if (t.length === 0) return "Escribí un comentario.";
  if (t.length > MAX_COMMENT_LENGTH) return `El comentario puede tener hasta ${MAX_COMMENT_LENGTH} caracteres.`;
  return null;
}
