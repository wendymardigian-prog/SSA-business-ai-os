/**
 * Qué muestra un hilo de comentarios (F132). Puro: lo arma `CommentThread` y lo prueba `thread.test.ts`.
 *
 * - Orden cronológico (el más viejo arriba, el cuadro de escribir abajo).
 * - Los borrados no aparecen.
 * - «editado» si se editó.
 * - Un comentario de sistema va en gris y sin acciones.
 * - Solo el autor edita y borra lo suyo.
 * - Destacado: los comentarios donde me mencionaron y todavía no abrí (los avisos `mentioned` sin leer).
 */

export type CommentRow = {
  id: string;
  kind: "comment" | "system";
  author_id: string | null;
  body: string;
  mentions: string[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type ThreadItem = {
  id: string;
  kind: "comment" | "system";
  authorId: string | null;
  body: string;
  createdAt: string;
  edited: boolean;
  canEdit: boolean;
  highlighted: boolean;
};

export type CommentEntity = "task" | "call";

export const COMMENT_ENTITY_LABEL: Record<CommentEntity, string> = { task: "tarea", call: "reunión" };

export function threadItems(rows: readonly CommentRow[], viewerId: string | null, unreadMentionCommentIds: readonly string[] = []): ThreadItem[] {
  const unread = new Set(unreadMentionCommentIds);
  return rows
    .filter((r) => !r.deleted_at)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      authorId: r.author_id,
      body: r.body,
      createdAt: r.created_at,
      edited: Boolean(r.edited_at),
      canEdit: r.kind === "comment" && viewerId !== null && r.author_id === viewerId,
      highlighted: r.kind === "comment" && unread.has(r.id),
    }));
}

/**
 * Parte el cuerpo en texto y menciones para dibujar los `@Nombre` resaltados. Una mención se reconoce por el nombre
 * de una persona que quedó en `mentions` (no por cualquier `@`).
 */
export function bodySegments(body: string, mentionNames: readonly string[]): Array<{ text: string; mention: boolean }> {
  const tokens = [...new Set(mentionNames.filter(Boolean).map((n) => `@${n.trim().replace(/\s+/g, " ")}`))]
    .sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return [{ text: body, mention: false }];
  const out: Array<{ text: string; mention: boolean }> = [];
  let i = 0;
  let plain = "";
  while (i < body.length) {
    const hit = tokens.find((t) => body.startsWith(t, i));
    if (hit) {
      if (plain) out.push({ text: plain, mention: false });
      plain = "";
      out.push({ text: hit, mention: true });
      i += hit.length;
    } else {
      plain += body[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

/** Traduce los errores de la base a palabras (CM001, CM002, CM003). */
export function commentErrorMessage(hint: string | null | undefined, fallback: string): string {
  switch (hint) {
    case "CM001": return "No podés comentar acá.";
    case "CM002": return "Solo podés editar o borrar tus comentarios.";
    case "CM003": return "El comentario tiene que tener entre 1 y 5000 caracteres.";
    default: return fallback;
  }
}
