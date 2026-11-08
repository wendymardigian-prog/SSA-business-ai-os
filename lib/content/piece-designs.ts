/**
 * Lo del Diseñador IA que se ve en el drawer de una pieza (DS8, F62 y F65): puro, con su test.
 *
 * Los archivos que arma un diseño se agrupan en la biblioteca bajo «Del diseño <nombre> · N archivos · vinculado», con su
 * botón «Abrir el diseño». Cuando el diseño cambió y la red está programada (o falló) aparece arriba de «Archivos» el
 * aviso «El diseño cambió» con «Actualizar los archivos» y «Dejar como está». Y el botón «✦ Diseñar con el Diseñador IA»
 * (o «✦ Diseñar otra versión» si ya hay uno) con los permisos que corresponden: lo que el permiso no da se oculta.
 *
 * No toca publicar, programar ni el borrado de media publicada: solo decide qué se muestra.
 */

import type { MediaEntry } from "./media";
import type { NetworkStateId } from "./network-state";
import type { NetworkEntry } from "./redistribution";
import { DESIGN_CHANGED_TEXT, designGroups, designSyncStatus, type DesignSyncStatus } from "@/lib/designer/content-sync";
import { designPlatformChoices, type DesignPlatformChoice } from "@/lib/designer/content-pieces";
import type { PieceDesign, PieceDesigner } from "@/lib/designer/content-link-types";
import { platformLabel } from "@/lib/platforms";

export { designGroups };

/** El link que abre el editor de un diseño con «← Volver a la pieza». */
export function openDesignHref(designId: string): string {
  return `/dashboard/disenos/d/${designId}?desde=pieza`;
}

export interface DesignGroupView {
  designId: string;
  /** El nombre del diseño; null si la persona no puede ver diseños y no se lo puede leer. */
  name: string | null;
  entries: MediaEntry[];
  linked: boolean;
  /** «Del diseño Carrusel · 5 archivos · vinculado». */
  heading: string;
  /** A dónde lleva «Abrir el diseño»; null = no se ofrece (sin permiso de ver diseños, o el diseño ya no existe). */
  openHref: string | null;
  status: DesignSyncStatus;
  /** La red del vínculo y su estado en la pieza (para el texto del aviso). */
  network: string | null;
  networkState: NetworkStateId | null;
}

const files = (n: number) => `${n} ${n === 1 ? "archivo" : "archivos"}`;

/** Los grupos «Del diseño …» de la biblioteca, con su estado de sincronización. */
export function designGroupViews(params: { media: MediaEntry[]; designs: PieceDesign[]; networkStates: Record<string, NetworkStateId>; canView: boolean }): DesignGroupView[] {
  return designGroups(params.media).map((group) => {
    const design = params.designs.find((d) => d.id === group.designId) ?? null;
    const linked = design?.linked ?? false;
    const network = linked ? (design?.network ?? null) : null;
    const networkState = network ? (params.networkStates[network] ?? null) : null;
    // Un diseño que ya no está vinculado (o no se puede leer) no sincroniza: no hay nada pendiente.
    const status: DesignSyncStatus = design && linked ? designSyncStatus({ designRev: design.rev, syncedVersion: group.version, networkState }) : "synced";
    const name = design?.name ?? null;
    return {
      designId: group.designId,
      name,
      entries: group.entries,
      linked,
      heading: `Del diseño${name ? ` ${name}` : ""} · ${files(group.entries.length)} · ${linked ? "vinculado" : "ya no está vinculado"}`,
      openHref: design && params.canView && design.canOpen ? openDesignHref(design.id) : null,
      status,
      network,
      networkState,
    };
  });
}

/** Los diseños vinculados a los que todavía no se les armaron los archivos (recién vinculados): «Preparando los archivos…». */
export function preparingDesigns(params: { media: MediaEntry[]; designs: PieceDesign[] }): PieceDesign[] {
  const withFiles = new Set(designGroups(params.media).map((g) => g.designId));
  return params.designs.filter((d) => d.linked && !d.archived && !withFiles.has(d.id));
}

export interface DesignChangedNotice {
  designId: string;
  name: string | null;
  title: string;
  body: string;
  update: string;
  keep: string;
}

/** El aviso «El diseño cambió»: uno por diseño vinculado cuya red está programada (o falló) y el diseño es más nuevo que los archivos. */
export function designChangedNotices(views: DesignGroupView[]): DesignChangedNotice[] {
  return views
    .filter((v) => v.status === "changed")
    .map((v) => ({
      designId: v.designId,
      name: v.name,
      title: DESIGN_CHANGED_TEXT.title,
      body: v.networkState === "fail" ? `La publicación en ${platformLabel(v.network ?? "")} falló: los archivos no se cambiaron solos.` : DESIGN_CHANGED_TEXT.body,
      update: DESIGN_CHANGED_TEXT.update,
      keep: DESIGN_CHANGED_TEXT.keep,
    }));
}

/** Si hay algo que el servidor todavía va a actualizar solo (el drawer vuelve a preguntar un rato). */
export function hasPendingSync(views: DesignGroupView[], preparing: PieceDesign[]): boolean {
  return preparing.length > 0 || views.some((v) => v.status === "pending");
}

export const DESIGN_BUTTON_TEXT = {
  design: "✦ Diseñar con el Diseñador IA",
  another: "✦ Diseñar otra versión",
  open: "Abrir el diseño",
  preparing: "Preparando los archivos del diseño…",
  updating: "Actualizando los archivos con la versión nueva del diseño…",
  chooseNetwork: "¿Para qué red?",
} as const;

export interface DesignerActions {
  /** El botón «✦ Diseñar…»: null = no se ofrece (la persona no puede diseñar o no puede escribir la pieza). */
  design: { label: string; choices: DesignPlatformChoice[]; /** Las redes de los diseños vinculados, para ofrecer primero las de siempre. */ preferred: string[] } | null;
  /** «Abrir el diseño» de cada diseño vinculado (solo con permiso de ver diseños). */
  open: Array<{ designId: string; name: string; href: string }>;
}

/** Los botones del Diseñador IA en la sección Archivos. Sin permiso, se ocultan (no se deshabilitan). */
export function designerActions(params: { designer: PieceDesigner | undefined; networks: NetworkEntry[] }): DesignerActions {
  const designer = params.designer;
  if (!designer) return { design: null, open: [] };
  const linked = designer.designs.filter((d) => d.linked && !d.archived);
  const open = designer.canView ? linked.filter((d) => d.canOpen).map((d) => ({ designId: d.id, name: d.name, href: openDesignHref(d.id) })) : [];
  if (!designer.canDesign) return { design: null, open };
  return {
    design: {
      label: linked.length > 0 ? DESIGN_BUTTON_TEXT.another : DESIGN_BUTTON_TEXT.design,
      choices: designPlatformChoices(params.networks),
      preferred: linked.flatMap((d) => (d.network ? [d.network] : [])),
    },
    open,
  };
}

/** A qué red va el diseño cuando hay una sola opción (se pide directo, sin preguntar); null = hay que preguntar. */
export function singleDesignPlatform(actions: NonNullable<DesignerActions["design"]>): string | null {
  return actions.choices.length === 1 && !actions.choices[0].isNew ? actions.choices[0].platform : null;
}

/** Si la pieza tiene el Diseñador IA a mano para algo (para no dibujar nada sin permisos ni diseños). */
export function showsDesignerSection(actions: DesignerActions, views: DesignGroupView[], preparing: PieceDesign[]): boolean {
  return actions.design !== null || actions.open.length > 0 || views.length > 0 || preparing.length > 0;
}
