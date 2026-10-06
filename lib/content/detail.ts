/**
 * Como le fue a cada red de una pieza (F36).
 *
 * Es la seccion "Estado por red" del drawer de la pieza (F96), que reemplazo
 * al detalle: que se publico, donde y como quedo cada red. Los botones que
 * ofrecia el detalle ahora son los del pie del drawer (`pieceButtons`).
 * Todo derivado, sin estado propio: si dijera algo distinto del tablero, uno
 * de los dos estaria mintiendo.
 */

import type { SocialPostStatus } from "@/lib/types/database";

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
