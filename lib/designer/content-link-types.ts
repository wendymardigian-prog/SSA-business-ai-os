/**
 * Los tipos del vínculo entre un diseño y una pieza de Contenido (DS8). Viven aparte porque un archivo `"use server"`
 * solo puede exportar funciones asincrónicas (`lib/actions/designer/content.ts`), y los lee el navegador.
 */

import type { NetworkStateId } from "@/lib/content/network-state";
import type { ContentTarget, PageFit } from "./content-map";
import type { PieceChoice } from "./content-pieces";
import type { FormatKey } from "./formats";

/** Una red de la pieza con el estado que le da la cola de publicación. */
export interface LinkedNetwork {
  platform: string;
  /** «Instagram Carrusel». */
  label: string;
  state: NetworkStateId;
  /** «Programado», «Publicado a mano»… */
  stateLabel: string;
}

/** A qué pieza está vinculado un diseño (el menú «En contenido ▾»). */
export interface ContentLinkInfo {
  postId: string;
  title: string;
  statusLabel: string;
  networks: LinkedNetwork[];
  /** El link que abre el drawer de la pieza. */
  href: string;
  /** La red principal del vínculo. */
  network: string | null;
}

/** Una publicación que ofrece el modal para el diseño. */
export interface ModalNetwork {
  platform: string;
  /** El formato de la red en Contenido (`carousel`, `pdf`…). */
  format: string;
  label: string;
  fit: PageFit;
  note: string | null;
}

/** Todo lo que necesita el modal «Usar en contenido» para dibujarse. */
export interface UseInContentModalData {
  designName: string;
  format: FormatKey;
  pageCount: number;
  /** Las publicaciones donde sirve este diseño, en el orden de la tabla. */
  networks: ModalNetwork[];
  /** Si la persona puede pedirle el caption al copywriter (permiso de IA). */
  canCopy: boolean;
  linked: ContentLinkInfo | null;
}

/** Los diseños de una pieza, para el drawer (grupo «Del diseño…», aviso y botón). */
export interface PieceDesign {
  id: string;
  name: string;
  /** La red principal del vínculo (null = ya no está vinculado). */
  network: string | null;
  /** La versión (`rev`) actual del diseño. */
  rev: number;
  /** Sigue vinculado a ESTA pieza. */
  linked: boolean;
  archived: boolean;
  /** Si quien mira puede abrirlo (`designer.view`). */
  canOpen: boolean;
}

/** Lo que el drawer de la pieza sabe del Diseñador IA. */
export interface PieceDesigner {
  /** `designer.edit` + `content.create` + poder escribir la pieza: muestra el botón de diseñar. */
  canDesign: boolean;
  canView: boolean;
  designs: PieceDesign[];
}

export type { ContentTarget, PieceChoice };

export interface DesignFromPieceData {
  designId: string;
  /** Abre el editor con «← Volver a la pieza». */
  href: string;
  /** Si la IA no pudo arrancar (no hay IA conectada, por ejemplo): el diseño igual quedó creado. */
  notice?: string;
}

export interface UseInContentData {
  postId: string;
  href: string;
  notice?: string;
}

export interface SyncToPieceData {
  queued: boolean;
  /** La pieza está programada: hay que confirmar en la pieza («Actualizar los archivos»). */
  needsConfirmation?: boolean;
  /** Todas las redes de la pieza ya salieron: no se toca nada. */
  published?: boolean;
  href?: string;
}
