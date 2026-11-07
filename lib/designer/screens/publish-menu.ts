/**
 * Lo que decide el menú Publicar / ● Publicado de la barra del editor (F45, F47), sin tocar la pantalla.
 *
 * - Lo que el permiso no da se OCULTA (no se deshabilita): sin `designer.publish` no hay publicar, despublicar
 *   ni opciones; sin `designer.generate` no hay «Anular». Si no queda nada que mostrar, no hay menú.
 * - «Permitir que aparezca en buscadores» solo existe en una página web; «Permitir descargar», en lo demás
 *   (una página web no se descarga: se comparte con su link).
 * - «Anular» solo en una pieza con verificación que está válida (una anulada no se vuelve a anular).
 *
 * Módulo puro: el componente solo lo dibuja.
 */

import type { PublishMenuProps } from "../contracts";
import { docTypeNoun, verificationTitle } from "../verification";
import { MAX_VOID_REASON } from "../publishing-limits";

export interface PublishMenuState {
  published: boolean;
  /** El link ya armado con el dominio del negocio (viene del servidor), o null si todavía no se conoce. */
  link: string | null;
}

export interface PublishMenuView {
  /** Si hay algo para mostrar. */
  visible: boolean;
  trigger: { text: string; published: boolean };
  /** La explicación de arriba del menú. */
  note: string | null;
  /** El link, si existe, y si ya funciona o funciona al publicar. */
  link: { url: string; live: boolean } | null;
  /** Si no hay link todavía, qué decir. */
  linkHint: string | null;
  downloadToggle: boolean;
  indexingToggle: boolean;
  publishNow: boolean;
  unpublish: boolean;
  copy: boolean;
  viewAsPublic: boolean;
  verification: { text: string; canVoid: boolean; voidLabel: string; voidTitle: string } | null;
}

export function publishMenuView(props: Pick<PublishMenuProps, "format" | "can" | "verification">, state: PublishMenuState): PublishMenuView {
  const { can, verification } = props;
  const web = props.format === "web";
  const visible = can.publish || (can.generate && verification !== null);
  const linkLive = state.link !== null && (state.published || verification !== null);

  const noun = verification ? docTypeNoun(verification.docType, verification.docTypeLabel).toLowerCase() : "documento";
  return {
    visible,
    trigger: { text: state.published ? "Publicado" : "Publicar", published: state.published },
    note: state.published ? "Quien tenga el link lo puede ver." : can.publish ? "Crea un link público: quien lo tenga lo puede ver." : null,
    link: state.link ? { url: state.link, live: linkLive } : null,
    linkHint: state.link ? null : can.publish && !state.published ? "El link aparece al publicar." : null,
    downloadToggle: can.publish && !web,
    indexingToggle: can.publish && web,
    publishNow: can.publish && !state.published,
    unpublish: can.publish && state.published,
    copy: linkLive,
    viewAsPublic: linkLive,
    verification: verification
      ? {
          text: `Verificación: ${verificationTitle(verification.docType, verification.status)}`,
          canVoid: can.generate && verification.status === "valid",
          voidLabel: `Anular ${noun}…`,
          voidTitle: `Anular ${noun}`,
        }
      : null,
  };
}

/** Qué le falta al motivo de una anulación (null = está bien). */
export function voidReasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "Escribí el motivo de la anulación.";
  if (trimmed.length > MAX_VOID_REASON) return `El motivo es demasiado largo (hasta ${MAX_VOID_REASON} caracteres).`;
  return null;
}
