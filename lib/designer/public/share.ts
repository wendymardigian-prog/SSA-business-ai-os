/**
 * La tarjeta del link público (F43): título, descripción e imagen al compartir `/d/<código>` por WhatsApp o redes.
 *
 * Los links salen del dominio del NEGOCIO (`publicBaseUrl`, vía `buildShareData`), nunca del host del pedido:
 * `og:url` y la imagen empiezan con el dominio propio del negocio si lo tiene, y si no con el principal.
 * Mientras la pieza se prepara no se dice su nombre (puede ser el de una persona).
 */

import { buildShareData, type ShareData } from "@/lib/og/share";
import { shareVersion, truncateText } from "@/lib/og/text";
import type { PublicRecord } from "./load";
import { publicDescription, publicTitle, type PublicView } from "./model";

export function designShare(record: PublicRecord, view: PublicView): ShareData {
  const { pub } = record;
  const title = publicTitle(pub, view);
  const description = publicDescription(pub, view);
  const share = buildShareData(record.workspace, `/d/${encodeURIComponent(pub.code)}`, {
    title,
    description,
    imageTitle: truncateText(title, 90),
    imageSubtitle: pub.businessName,
  });
  // La imagen puede ser la página 1 ya renderizada: cuando se vuelve a renderizar, la URL cambia y nadie ve la vieja.
  return { ...share, version: shareVersion([share.version, pub.renderedVersion ?? "", pub.status]) };
}

/** De dónde sale la imagen de la tarjeta: la página 1 de los archivos de publicar, o la imagen generada con la marca. */
export type PreviewSource = { kind: "page"; path: string } | { kind: "generated" };

export function previewSource(record: Pick<PublicRecord, "renders">, view: PublicView): PreviewSource {
  const first = record.renders?.pages[0];
  // Una pieza anulada o que se está preparando no muestra su imagen en la tarjeta.
  if (view.screen === "pieces" && !view.voidStamp && first) return { kind: "page", path: first };
  return { kind: "generated" };
}
