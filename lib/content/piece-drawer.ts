/**
 * Lo que decide el drawer de la pieza (F96).
 *
 * El drawer reemplaza al editor (F24) y al detalle (F36): una sola pantalla
 * donde se escribe, se revisa y se publica. Aca vive lo que decide, sin React
 * ni base: que estados ofrece el dropdown, que accion dispara cada cambio, que
 * dice el pie y que botones lleva segun el permiso.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import { platformLabel } from "@/lib/platforms";
import type { PublicationSummary } from "./detail";
import { markPublishedOffer } from "./mark-published";
import { editorActions, type EditorButton, type EditorPermissions } from "./editor";
import type { NetworkEntry } from "./redistribution";
import { STATUS_LABELS, canTransition, type ContentPermissions } from "./status";

/**
 * Si quien mira puede escribir la pieza: lo mismo que la politica de
 * `content_posts` (00253). Un administrador siempre; un Member la que creo o la
 * que tiene asignada. **En cualquier estado** (cambio aprobado M10, 22/10/2026):
 * antes un Member solo editaba hasta revision y la pantalla bloqueaba a todos
 * desde Aprobado, aunque la base dejaba a Owner y Admin. Una pieza aprobada,
 * programada o publicada se sigue corrigiendo (un caption con un error, el
 * guion para reusarlo); lo programado en Zernio se le reenvia solo al guardar.
 * Cualquier otra cosa la base la rechaza, asi que la pantalla no puede
 * ofrecerla como editable.
 */
export function canWritePost(params: { role: string; isAuthor: boolean }): boolean {
  if (params.role === "owner" || params.role === "admin") return true;
  return params.isAuthor;
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
 *
 * "Publicado…" se ofrece al final como ATAJO (22/10/2026): no cambia el estado,
 * abre la ventanita para marcar las redes que salieron por fuera
 * (`lib/content/mark-published.ts`). El estado lo siguen calculando las redes.
 */
export function statusOptions(perms: ContentPermissions, current: ContentPostStatus): StatusOption[] {
  const values = SELECTABLE.includes(current) ? SELECTABLE : [...SELECTABLE, current];

  const options: StatusOption[] = values.map((value) => {
    if (value === current) return { value, label: STATUS_LABELS[value], disabled: false };

    const decision = canTransition(perms, current, value);
    return decision.ok
      ? { value, label: STATUS_LABELS[value], disabled: false }
      : { value, label: STATUS_LABELS[value], disabled: true, reason: decision.reason };
  });

  const offer = markPublishedOffer({ canPublish: perms.publish, status: current });
  if (offer.offered) {
    options.push(
      offer.disabled
        ? { value: "published", label: MARK_PUBLISHED_LABEL, disabled: true, reason: offer.reason }
        : { value: "published", label: MARK_PUBLISHED_LABEL, disabled: false },
    );
  }
  return options;
}

/** Con los puntos suspensivos: elegirlo abre algo, no cambia el estado en el momento. */
export const MARK_PUBLISHED_LABEL = "Publicado…";

export type StatusChange = "request_review" | "approve" | "return" | "move" | "mark_published";

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
  // Publicado no se elige: abre la ventanita para marcar las redes.
  if (to === "published") return "mark_published";
  if (to === "in_review") return "request_review";
  if (to === "approved") return "approve";
  if (from === "in_review" && (to === "draft" || to === "in_production")) return "return";
  return "move";
}


/**
 * Lo que conviene saber antes de editar una pieza que ya salio o ya esta
 * agendada (cambio aprobado M10): editar se puede siempre, pero no todo cambio
 * llega a todos lados.
 *
 * - Publicada: el post de la red ya es lo que es; cambiar aca no lo cambia.
 * - Agendada en Zernio: al guardar se le reenvia la version nueva.
 */
export function editNotices(publications: PublicationSummary[]): string[] {
  const live = publications.filter((p) => p.status && p.status !== "cancelled");
  const names = (list: PublicationSummary[]) => list.map((p) => platformLabel(p.platform)).join(", ");

  const notices: string[] = [];
  const published = live.filter((p) => p.status === "published");
  if (published.length > 0) {
    notices.push(
      `Ya está publicada en ${names(published)}: lo que cambies acá queda en la pieza, pero no cambia el post publicado.`,
    );
  }
  const onProvider = live.filter((p) => p.onProvider && (p.status === "scheduled" || p.status === "uploading"));
  if (onProvider.length > 0) {
    notices.push(`Programada en ${names(onProvider)}: al guardar, la versión nueva se manda también a Zernio.`);
  }
  return notices;
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
  /** El responsable (id de la persona), o "" si no tiene. */
  assignedTo: string;
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
  assignedTo?: string | null;
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
    assignedTo: post.assignedTo ?? "",
  };
}

/**
 * Lo que se manda a `savePostDraft`: el borrador entero.
 *
 * Los textos vacios viajan como null (asi "sin pilar" se distingue de un pilar
 * en blanco) y el formato y la referencia se recortan.
 */
export function draftPayload(postId: string, draft: PieceDraft, savedAssignee?: string) {
  return {
    // El responsable solo viaja si cambio respecto de lo guardado: mandarlo
    // siempre pisaria, con un valor viejo, el cambio que hizo otra persona.
    ...(savedAssignee !== undefined && draft.assignedTo === savedAssignee ? {} : { assigned_to: draft.assignedTo || null }),
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
