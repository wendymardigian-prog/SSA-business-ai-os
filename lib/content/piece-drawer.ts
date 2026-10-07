/**
 * Lo que decide el drawer de la pieza (F96).
 *
 * El drawer reemplaza al editor (F24) y al detalle (F36): una sola pantalla
 * donde se escribe, se revisa y se publica. Aca vive lo que decide, sin React
 * ni base: que estados ofrece el dropdown, que accion dispara cada cambio, que
 * dice el pie y que botones lleva segun el permiso.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import { editorActions, type EditorButton, type EditorPermissions } from "./editor";
import type { NetworkEntry } from "./redistribution";
import { STATUS_LABELS, canTransition, type ContentPermissions } from "./status";

/** Los estados que una persona puede tocar: lo demas lo pone el sistema. */
export const EDITABLE_STATUSES: ContentPostStatus[] = ["draft", "in_production", "in_review"];

export function isEditableStatus(status: ContentPostStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * El color de cada estado, para el dropdown teñido (C4). Los mismos nombres
 * que usa el kanban (F17): nada nuevo, solo se reusan.
 */
export const STATUS_COLOR: Record<ContentPostStatus, string> = {
  draft: "var(--muted-foreground)",
  in_production: "var(--zn)",
  in_review: "var(--c-auto)",
  approved: "var(--primary)",
  scheduled: "var(--li)",
  publishing: "var(--li)",
  published: "var(--good)",
  partially_published: "var(--warn)",
  failed: "var(--bad)",
};

export interface StatusOption {
  value: ContentPostStatus;
  label: string;
  disabled: boolean;
  /** Por que no se puede elegir. */
  reason?: string;
}

/** Los estados que el dropdown ofrece elegir, en el orden del tablero. */
const SELECTABLE: ContentPostStatus[] = ["draft", "in_production", "in_review", "approved"];

/**
 * Las opciones del dropdown de estado.
 *
 * Siempre esta el estado actual (habilitado). Las demas salen de
 * `canTransition`, la misma regla que usa el tablero al arrastrar: las que no
 * se pueden van deshabilitadas CON el motivo, porque "no se puede" sin
 * explicacion obliga a adivinar. "Programado" no se ofrece: programar es elegir
 * fecha por red y apretar el boton del pie, no cambiar un campo.
 */
export function statusOptions(perms: ContentPermissions, current: ContentPostStatus): StatusOption[] {
  const values = SELECTABLE.includes(current) ? SELECTABLE : [...SELECTABLE, current];

  return values.map((value) => {
    if (value === current) return { value, label: STATUS_LABELS[value], disabled: false };

    const decision = canTransition(perms, current, value);
    return decision.ok
      ? { value, label: STATUS_LABELS[value], disabled: false }
      : { value, label: STATUS_LABELS[value], disabled: true, reason: decision.reason };
  });
}

export type StatusChange = "request_review" | "approve" | "return" | "move";

/**
 * Que accion dispara un cambio del dropdown.
 *
 * Mandar a revision y aprobar tienen su propia accion porque ADEMAS avisan
 * (a quien revisa, a quien escribio); devolver pide un motivo. Moverla con
 * `movePostToColumn` se saltearia los avisos: seria cambiar el estado sin que
 * nadie se entere.
 */
export function statusChangeAction(from: ContentPostStatus, to: ContentPostStatus): StatusChange | null {
  if (from === to) return null;
  if (to === "in_review") return "request_review";
  if (to === "approved") return "approve";
  if (from === "in_review" && (to === "draft" || to === "in_production")) return "return";
  return "move";
}


/** Si hay algo que mostrar en "estado por red": una publicacion viva, no cancelada. */
export function publicationsVisible(publications: Array<{ status: string | null }>): boolean {
  return publications.some((p) => p.status && p.status !== "cancelled");
}

export type PieceButton = Omit<EditorButton, "action"> & {
  action: EditorButton["action"] | "retry_all";
};

/**
 * Los botones del pie.
 *
 * Los del editor, mas "reintentar las que fallaron" (que vivia en el detalle).
 * Un Member no ve Programar, Publicar ahora ni Generar: no estan; lo que se
 * puede hacer cuando falta algo, si (deshabilitado con el motivo).
 */
export function pieceButtons(params: {
  status: ContentPostStatus;
  perms: EditorPermissions;
  hasDates: boolean;
  aiAvailable: boolean;
  schedulable: number;
  publications: Array<{ status: string | null }>;
}): PieceButton[] {
  const buttons: PieceButton[] = editorActions(params);

  // Reintentar solo lo que fallo y solo quien publica: reintentar algo que
  // salio seria publicarlo dos veces.
  if (params.perms.publish && params.publications.some((p) => p.status === "failed")) {
    const at = buttons.findIndex((b) => b.action === "archive");
    const retry: PieceButton = { action: "retry_all", label: "Reintentar las que fallaron", tone: "primary" };
    if (at === -1) buttons.push(retry);
    else buttons.splice(at, 0, retry);
  }

  return buttons;
}

// ── El borrador del drawer ─────────────────────────────────────────────────

/** Lo que se edita en el drawer, tal como vive en el estado de la pantalla. */
export interface PieceDraft {
  title: string;
  script: string;
  recording_notes: string;
  format: string;
  pillarId: string;
  offerId: string;
  funnelStage: string;
  reference: string;
  caption: string;
  networks: NetworkEntry[];
}

/** El borrador a partir de lo que hay guardado. */
export function draftFromPost(post: {
  title: string;
  script: string | null;
  recordingNotes: string | null;
  format: string | null;
  pillarId: string | null;
  offerId: string | null;
  funnelStage: string | null;
  reference: string | null;
  caption: string | null;
  networks: NetworkEntry[];
}): PieceDraft {
  return {
    title: post.title,
    script: post.script ?? "",
    recording_notes: post.recordingNotes ?? "",
    format: post.format ?? "",
    pillarId: post.pillarId ?? "",
    offerId: post.offerId ?? "",
    funnelStage: post.funnelStage ?? "",
    reference: post.reference ?? "",
    caption: post.caption ?? "",
    networks: post.networks,
  };
}

/**
 * Lo que se manda a `savePostDraft`: el borrador entero.
 *
 * Los textos vacios viajan como null (asi "sin pilar" se distingue de un pilar
 * en blanco) y el formato y la referencia se recortan.
 */
export function draftPayload(postId: string, draft: PieceDraft) {
  return {
    postId,
    title: draft.title,
    format: draft.format.trim() || null,
    pillar_id: draft.pillarId || null,
    offer_id: draft.offerId || null,
    funnel_stage: draft.funnelStage || null,
    reference: draft.reference.trim() || null,
    script: draft.script,
    recording_notes: draft.recording_notes,
    caption: draft.caption,
    networks: draft.networks,
  };
}

// ── El copywriter escribiendo ──────────────────────────────────────────────

type CopyStatus = "idle" | "generating" | "failed";

/** Mientras el copywriter escribe, el drawer vuelve a preguntar hasta que termine. */
export function shouldPollCopy(status: CopyStatus): boolean {
  return status === "generating";
}

/**
 * Si el copywriter acaba de terminar (de escribiendo a no escribiendo).
 *
 * Es el momento de volver a leer el texto desde lo guardado: el borrador
 * local nacio vacio y, sin esto, el guion que acaba de escribir la IA
 * quedaria invisible hasta recargar la pagina.
 */
export function copyJustFinished(previous: CopyStatus, next: CopyStatus): boolean {
  return previous === "generating" && next !== "generating";
}
