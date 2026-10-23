/**
 * "Publicado…" desde el estado de la pieza (22/10/2026).
 *
 * Publicado no es un estado que se elige: lo calculan las redes
 * (`derivePieceStatus`). Lo que se le ofrece a la persona es un atajo para lo
 * que ya existia red por red ("Marcar como publicado", Contenido v4 C3): una
 * ventanita con las redes, la fecha y un link por red, que crea las mismas
 * filas reales con `origin = 'manual'`. Asi una pieza que se subio por fuera
 * (LinkedIn sin cuenta conectada, por ejemplo) queda Publicada en un paso, y
 * el estado sigue siendo verdad: cuenta en el calendario, en Social y en las
 * metricas.
 *
 * Sin React ni base: lo usan el dropdown del drawer, el tablero y la ventanita.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import type { PublicationSummary } from "./detail";
import { CONTENT_PLATFORMS } from "./network-format";

/** Mientras se esta publicando no se marca nada a mano: serian dos publicaciones. */
const NOT_MARKABLE: ContentPostStatus[] = ["published", "publishing"];

/** En la URL de la pieza: abrirla con la ventanita ya abierta (soltar en la columna Publicado). */
export const MARK_PUBLISHED_PARAM = "marcar";

export const MARK_PUBLISHED_FORBIDDEN = "Marcar como publicado es de quien puede publicar.";

/** Si el atajo se ofrece, y si no, por que. */
export function markPublishedOffer(params: {
  canPublish: boolean;
  status: ContentPostStatus;
}): { offered: false } | { offered: true; disabled: false } | { offered: true; disabled: true; reason: string } {
  if (NOT_MARKABLE.includes(params.status)) return { offered: false };
  if (!params.canPublish) return { offered: true, disabled: true, reason: MARK_PUBLISHED_FORBIDDEN };
  return { offered: true, disabled: false };
}

export interface MarkPublishedChoice {
  platform: string;
  /** Si la pieza ya tiene esa red. Una que no tiene se le suma al marcar. */
  inPiece: boolean;
  /** Tildada al abrir: todas las de la pieza que faltan publicar. */
  checked: boolean;
}

/**
 * Las redes que se ofrecen en la ventanita.
 *
 * Las de la pieza que todavia no salieron, tildadas (lo comun es "salio en
 * todas"). Si la pieza no tiene ninguna red, las cinco sin tildar: hay que
 * decir donde salio. Las que ya estan publicadas no aparecen.
 */
export function markPublishedChoices(params: {
  networks: string[];
  publications: Pick<PublicationSummary, "platform" | "status">[];
}): MarkPublishedChoice[] {
  const published = new Set(params.publications.filter((p) => p.status === "published").map((p) => p.platform));

  if (params.networks.length === 0) {
    return CONTENT_PLATFORMS.map((platform) => ({ platform, inPiece: false, checked: false }));
  }
  return params.networks
    .filter((platform) => !published.has(platform))
    .map((platform) => ({ platform, inPiece: true, checked: true }));
}
