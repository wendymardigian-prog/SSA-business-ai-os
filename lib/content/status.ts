/**
 * Los estados de una pieza y quien puede moverla (F17).
 *
 * Dos reglas distintas que conviene no mezclar:
 *
 *  1. **Hasta "aprobado", el estado lo mueve una persona** y `canTransition`
 *     dice si puede. Un Member mueve lo suyo entre borrador, produccion y
 *     revision; aprobar y programar es de quien tiene ese permiso.
 *
 *  2. **Desde "programado", el estado se DERIVA** de como le fue a cada red
 *     (`aggregatePostStatus`). No se guarda una decision: se lee la realidad.
 *     Si Instagram salio y TikTok fallo, el post esta "parcialmente
 *     publicado", y eso no depende de que nadie se acuerde de escribirlo.
 *
 * Todo puro: sin base, sin fechas, sin red.
 */

import type { ContentPostStatus, SocialPostStatus } from "@/lib/types/database";

/** Las columnas del kanban, en orden. */
export const BOARD_COLUMNS = [
  "ideas",
  "draft",
  "in_production",
  "in_review",
  "approved",
  "scheduled",
  "published",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  ideas: "Ideas",
  draft: "Borrador",
  in_production: "En produccion",
  in_review: "En revision",
  approved: "Aprobado",
  scheduled: "Programado",
  published: "Publicado",
};

export const STATUS_LABELS: Record<ContentPostStatus, string> = {
  draft: "Borrador",
  in_production: "En produccion",
  in_review: "En revision",
  approved: "Aprobado",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  partially_published: "Publicado en parte",
  failed: "Fallo",
};

/**
 * En que columna se dibuja cada estado.
 *
 * Los tres estados del final viven en la misma columna con un badge: separar
 * "publicado", "publicado en parte" y "fallo" en tres columnas haria un
 * tablero de nueve columnas donde tres estan casi siempre vacias.
 */
export function columnFor(status: ContentPostStatus): BoardColumn {
  switch (status) {
    case "publishing":
    case "published":
    case "partially_published":
    case "failed":
      return "published";
    case "scheduled":
      return "scheduled";
    default:
      return status;
  }
}

/** Lo que puede hacer quien esta mirando. */
export interface ContentPermissions {
  /** Crear y editar lo suyo. */
  create: boolean;
  /** Aprobar y devolver. */
  approve: boolean;
  /** Programar, publicar y reintentar. */
  publish: boolean;
  /** Es el autor de esta pieza. */
  isAuthor: boolean;
}

/** Los estados que un autor puede tocar libremente. */
const AUTHOR_STATES: ContentPostStatus[] = ["draft", "in_production", "in_review"];

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * Si se puede mover una pieza de un estado a otro.
 *
 * Devuelve el motivo cuando no se puede, porque el kanban lo muestra al
 * revertir el arrastre: "no se puede" sin explicacion obliga a adivinar.
 */
export function canTransition(
  perms: ContentPermissions,
  from: ContentPostStatus,
  to: ContentPostStatus,
): TransitionResult {
  if (from === to) return { ok: true };

  // Los estados derivados no se eligen: los escribe el sistema segun como
  // salio cada red.
  const derived: ContentPostStatus[] = ["publishing", "published", "partially_published", "failed"];
  if (derived.includes(to)) {
    return { ok: false, reason: "Ese estado lo pone el sistema cuando se publica, no se mueve a mano." };
  }
  if (derived.includes(from) && to !== "approved") {
    return { ok: false, reason: "Una pieza publicada no vuelve atras. Podes archivarla." };
  }

  if (to === "scheduled" || from === "scheduled") {
    if (!perms.publish) {
      return { ok: false, reason: "Programar y desprogramar es de quien puede publicar." };
    }
    return { ok: true };
  }

  if (to === "approved") {
    if (!perms.approve) return { ok: false, reason: "Aprobar es de quien puede aprobar." };
    if (from !== "in_review") {
      return { ok: false, reason: "Primero hay que enviarla a revision." };
    }
    return { ok: true };
  }

  if (from === "approved") {
    // Devolver una pieza aprobada a borrador es deshacer una aprobacion.
    if (!perms.approve) return { ok: false, reason: "Solo quien aprueba puede devolverla." };
    return { ok: true };
  }

  if (AUTHOR_STATES.includes(from) && AUTHOR_STATES.includes(to)) {
    if (perms.approve || perms.publish) return { ok: true };
    if (!perms.create) return { ok: false, reason: "No tenes permiso para editar contenido." };
    if (!perms.isAuthor) return { ok: false, reason: "Solo el autor puede mover su pieza." };
    return { ok: true };
  }

  return { ok: false, reason: "Ese movimiento no esta permitido." };
}

/**
 * El estado de la pieza, derivado de como le fue a cada red.
 *
 * El orden de las preguntas importa: mientras algo este saliendo, la pieza
 * esta publicando aunque otra red ya haya fallado. Y "publicado en parte" es
 * lo que hay cuando al menos una salio y al menos una no.
 */
export function aggregatePostStatus(
  publications: Array<{ status: SocialPostStatus | null }>,
): ContentPostStatus {
  const live = publications.filter((p) => p.status && p.status !== "cancelled");

  // Sin ninguna red viva, la pieza volvio a estar aprobada y sin programar.
  if (live.length === 0) return "approved";

  const has = (status: SocialPostStatus) => live.some((p) => p.status === status);
  const all = (status: SocialPostStatus) => live.every((p) => p.status === status);

  if (all("published")) return "published";
  if (all("failed")) return "failed";
  if (has("publishing")) return "publishing";
  if (has("published") && has("failed")) return "partially_published";
  // Queda algo programado (con o sin una publicada al lado): sigue programada.
  if (has("scheduled")) return has("published") ? "partially_published" : "scheduled";

  return "scheduled";
}

/**
 * Marcar el material como grabado empuja la pieza a produccion.
 *
 * Es el unico cambio de estado que se dispara por otra cosa: la persona marca
 * "ya lo grabe" y el tablero se actualiza solo, en vez de pedirle que ademas
 * arrastre la tarjeta.
 */
export function statusAfterMaterialChange(
  current: ContentPostStatus,
  material: "pendiente" | "grabado" | "editado" | "listo",
): ContentPostStatus {
  if (current === "draft" && material !== "pendiente") return "in_production";
  return current;
}
