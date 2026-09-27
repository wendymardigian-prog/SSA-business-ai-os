/**
 * Lo que muestra el detalle de una pieza (F36).
 *
 * Una pantalla que contesta cuatro preguntas sin hacer clic: que se publico,
 * donde, como quedo cada red y que se puede hacer ahora. Todo derivado, sin
 * estado propio: si el detalle dijera algo distinto del tablero, uno de los
 * dos estaria mintiendo.
 */

import type { ContentPostStatus, SocialPostStatus } from "@/lib/types/database";
import { STATUS_LABELS, type ContentPermissions } from "./status";
import { canApprove, canEditContent, canRequestReview } from "./review";

export interface PublicationSummary {
  platform: string;
  status: SocialPostStatus | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  url: string | null;
  lastError: string | null;
  lastErrorKind: "temporary" | "permanent" | null;
  attempts: number;
  warning: string | null;
  actualVisibility: string | null;
}

export interface NetworkRow {
  platform: string;
  /** "Publicado · 1 oct 15:00", "No salio", "Programado · ..." */
  state: string;
  tone: "ok" | "pending" | "error" | "muted";
  /** El link al post en la red, cuando salio. */
  url: string | null;
  /** Que decir cuando algo no salio o salio distinto. */
  note: string | null;
  /** Se puede reintentar esta red. */
  canRetry: boolean;
}

const PUBLICATION_LABELS: Record<SocialPostStatus, string> = {
  uploading: "Preparando",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "No salio",
  cancelled: "Cancelado",
};

function formatAt(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Una fila por red, con su estado en palabras.
 *
 * "No salio" con el motivo al lado, y no un codigo: quien mira el detalle
 * quiere saber si tiene que hacer algo, no depurar una API.
 */
export function networkRows(
  publications: PublicationSummary[],
  params: { timeZone: string; canPublish: boolean },
): NetworkRow[] {
  return publications.map((pub) => {
    const when = formatAt(pub.publishedAt ?? pub.scheduledAt, params.timeZone);
    const label = pub.status ? PUBLICATION_LABELS[pub.status] : "Sin programar";

    const tone: NetworkRow["tone"] =
      pub.status === "published"
        ? "ok"
        : pub.status === "failed"
          ? "error"
          : pub.status === "cancelled" || !pub.status
            ? "muted"
            : "pending";

    // El aviso de visibilidad va aunque haya salido: un video publico que
    // quedo privado "salio", pero no lo ve nadie.
    const note = pub.lastError ?? pub.warning ?? null;

    return {
      platform: pub.platform,
      state: when ? `${label} · ${when}` : label,
      tone,
      url: pub.url,
      note,
      // Reintentar solo lo que fallo, y solo quien publica. Reintentar algo
      // que salio seria publicarlo dos veces.
      canRetry: params.canPublish && pub.status === "failed",
    };
  });
}

export interface DetailAction {
  action: "edit" | "request_review" | "approve" | "return" | "schedule" | "retry_all" | "archive";
  label: string;
  tone?: "primary" | "danger";
}

/**
 * Los botones del detalle, segun estado y permisos.
 *
 * Es la misma decision que toma el editor (`lib/content/editor.ts`) pero con
 * las acciones del detalle: ver un boton que despues rebota es peor que no
 * verlo.
 */
export function detailActions(params: {
  perms: ContentPermissions;
  status: ContentPostStatus;
  publications: PublicationSummary[];
}): DetailAction[] {
  const actions: DetailAction[] = [];
  const hasScheduled = params.publications.some((p) => p.status === "scheduled");
  const hasFailed = params.publications.some((p) => p.status === "failed");

  // Editar y Archivar viven en la barra superior (C16): son las dos cosas
  // que se hacen desde acá y estaban al final del cuerpo, después de todo lo
  // demás.
  if (canRequestReview(params.perms, params.status).ok) {
    actions.push({ action: "request_review", label: "Mandar a revision", tone: "primary" });
  }
  if (canApprove(params.perms, params.status).ok) {
    actions.push({ action: "approve", label: "Aprobar", tone: "primary" });
    actions.push({ action: "return", label: "Devolver" });
  }
  if (params.perms.publish && params.status === "approved") {
    actions.push({ action: "schedule", label: "Programar", tone: "primary" });
  }
  if (params.perms.publish && hasFailed) {
    actions.push({ action: "retry_all", label: "Reintentar las que fallaron", tone: "primary" });
  }
  return actions;
}

/** El encabezado del detalle, en una linea. */
export function detailHeadline(params: {
  status: ContentPostStatus;
  publications: PublicationSummary[];
}): string {
  const published = params.publications.filter((p) => p.status === "published").length;
  const total = params.publications.filter((p) => p.status && p.status !== "cancelled").length;

  if (total === 0) return STATUS_LABELS[params.status];
  if (published === total) return `${STATUS_LABELS[params.status]} en ${total} ${total === 1 ? "red" : "redes"}`;
  return `${STATUS_LABELS[params.status]} · ${published} de ${total} redes`;
}
