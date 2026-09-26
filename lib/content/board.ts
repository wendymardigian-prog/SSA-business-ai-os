/**
 * El tablero: como se agrupa y que se puede arrastrar (F20).
 *
 * Todo puro. La pantalla dibuja lo que esto devuelve, y el arrastre pregunta
 * antes de mover: si la respuesta es que no, la tarjeta vuelve a su lugar con
 * el motivo a la vista, en vez de quedar donde no corresponde hasta que
 * alguien recargue.
 */

import type { ContentIdeaStatus, ContentPostStatus, SocialPostStatus } from "@/lib/types/database";
import {
  BOARD_COLUMNS,
  COLUMN_LABELS,
  canTransition,
  columnFor,
  type BoardColumn,
  type ContentPermissions,
} from "./status";

export interface BoardIdea {
  kind: "idea";
  id: string;
  title: string;
  format: string | null;
  status: ContentIdeaStatus;
  createdBy: string | null;
  position: number;
}

export interface BoardNetwork {
  platform: string;
  /** La fecha tentativa o la programada, ya resuelta. */
  at: string | null;
  status: SocialPostStatus | null;
  /** Una fecha posterior a la primera de la pieza: es redistribucion. */
  redistribution?: boolean;
}

export interface BoardPost {
  kind: "post";
  id: string;
  title: string;
  format: string | null;
  status: ContentPostStatus;
  createdBy: string | null;
  position: number;
  networks: BoardNetwork[];
  hasCopy: boolean;
  hasCaption: boolean;
  copyFromAi: boolean;
  materialStatus: string;
}

export type BoardCard = BoardIdea | BoardPost;

export interface BoardColumnData {
  column: BoardColumn;
  label: string;
  cards: BoardCard[];
  count: number;
}

/**
 * Arma las columnas.
 *
 * Las ideas descartadas y aprobadas no se muestran: una descartada salio del
 * tablero (queda en el historial) y una aprobada ya vive como post, asi que
 * dejarla seria contar la misma cosa dos veces.
 */
export function buildBoard(ideas: BoardIdea[], posts: BoardPost[]): BoardColumnData[] {
  const byColumn = new Map<BoardColumn, BoardCard[]>(BOARD_COLUMNS.map((c) => [c, []]));

  for (const idea of ideas) {
    if (idea.status !== "nueva") continue;
    byColumn.get("ideas")!.push(idea);
  }

  for (const post of posts) {
    byColumn.get(columnFor(post.status))!.push(post);
  }

  return BOARD_COLUMNS.map((column) => {
    const cards = [...byColumn.get(column)!].sort(
      (a, b) => a.position - b.position || a.title.localeCompare(b.title),
    );
    return { column, label: COLUMN_LABELS[column], cards, count: cards.length };
  });
}

export type DropResult =
  | { ok: true; status: ContentPostStatus }
  | { ok: false; reason: string }
  /** No se puede mover todavia, pero hay algo que hacer: se abre el editor. */
  | { ok: false; reason: string; openEditor: true };

export interface DropContext {
  perms: ContentPermissions;
  post: Pick<BoardPost, "status" | "networks">;
  target: BoardColumn;
}

/** El estado que representa cada columna cuando se suelta una tarjeta ahi. */
function statusForColumn(column: BoardColumn): ContentPostStatus | null {
  switch (column) {
    case "ideas":
      return null;
    case "published":
      return null;
    default:
      return column;
  }
}

/**
 * Que pasa al soltar una tarjeta en una columna.
 *
 * El caso que importa es "Programado": arrastrar ahi una pieza sin fecha o sin
 * aprobar no puede fallar en silencio ni programar cualquier cosa. Se abre el
 * editor, que es donde se resuelve.
 */
export function evaluateDrop(context: DropContext): DropResult {
  const { perms, post, target } = context;

  if (target === "ideas") {
    return { ok: false, reason: "Una pieza no vuelve a ser una idea." };
  }
  if (target === "published") {
    return { ok: false, reason: "Publicar se hace desde el editor, con su fecha." };
  }

  const status = statusForColumn(target);
  if (!status) return { ok: false, reason: "Ese movimiento no esta permitido." };

  if (status === "scheduled") {
    if (!perms.publish) {
      return { ok: false, reason: "Programar es de quien puede publicar." };
    }
    const conFecha = post.networks.filter((n) => n.at);
    if (conFecha.length === 0) {
      return {
        ok: false,
        reason: "Todavia no hay ninguna red con fecha. Elegila en el editor.",
        openEditor: true,
      };
    }
    if (post.status !== "approved" && post.status !== "scheduled") {
      return {
        ok: false,
        reason: "La pieza no esta aprobada. Reviselo en el editor antes de programar.",
        openEditor: true,
      };
    }
    return { ok: true, status };
  }

  const allowed = canTransition(perms, post.status, status);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  return { ok: true, status };
}

/**
 * El orden nuevo al mover una tarjeta dentro de una columna.
 *
 * Se devuelven las posiciones de TODAS las tarjetas de la columna, ya
 * renumeradas de 10 en 10. Renumerar entero evita el problema de los huecos:
 * con posiciones intercaladas, despues de unas cuantas movidas dos tarjetas
 * terminan con el mismo numero y el orden se vuelve impredecible.
 */
export function reorder(
  cards: Array<{ id: string }>,
  movedId: string,
  toIndex: number,
): Array<{ id: string; position: number }> {
  const without = cards.filter((c) => c.id !== movedId);
  const moved = cards.find((c) => c.id === movedId);
  if (!moved) return cards.map((c, i) => ({ id: c.id, position: (i + 1) * 10 }));

  const index = Math.max(0, Math.min(toIndex, without.length));
  without.splice(index, 0, moved);

  return without.map((c, i) => ({ id: c.id, position: (i + 1) * 10 }));
}

/** El chip de redistribucion de una tarjeta publicada, si corresponde. */
export function redistributionChip(networks: BoardNetwork[]): string | null {
  const pending = networks.filter((n) => n.redistribution && n.status === "scheduled" && n.at);
  if (pending.length === 0) return null;

  const first = pending[0];
  const fecha = new Date(first.at!).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return pending.length === 1
    ? `↻ ${first.platform} programado ${fecha}`
    : `↻ ${pending.length} redes programadas`;
}
