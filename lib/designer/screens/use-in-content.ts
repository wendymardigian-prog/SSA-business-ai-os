/**
 * Lo que decide el botón «Usar en contenido» / «En contenido ▾» y su modal (DS8, F63): puro y con su test. El componente
 * (`components/designer/content/use-in-content.tsx`) solo lo compone.
 *
 * El modal tiene dos caminos: «Crear una pieza nueva» (título, redes con su formato —una publicación por red— y «Que el
 * copywriter proponga el caption») y «Vincular a una pieza existente» (buscador, y en qué red va). Qué se manda, qué se
 * puede confirmar y qué se le dice a la persona sale de acá.
 */

import { pickTargetForLink } from "../content-sync";
import type { ContentLinkInfo, ModalNetwork, PieceChoice, SyncToPieceData, UseInContentModalData } from "../content-link-types";
import type { UseInContentInput } from "../contracts";

/** Los textos fijos del botón y del modal (para que la pantalla y los tests digan lo mismo). */
export const USE_IN_CONTENT_TEXT = {
  button: "Usar en contenido",
  buttonLinked: "En contenido ▾",
  title: "Usar en contenido",
  modeNew: "Crear una pieza nueva",
  modeLink: "Vincular a una pieza existente",
  titleLabel: "Título de la pieza",
  networks: "Redes",
  captionLabel: "Caption con IA",
  captionHelp: "Que el copywriter proponga el caption a partir del diseño",
  draftHelp: "La pieza nace en Borrador en el tablero de Contenido.",
  searchLabel: "Buscar pieza",
  networkLabel: "¿En qué red va?",
  create: "Crear la pieza",
  link: "Vincular",
  alreadyHasDesign: "ya tiene un diseño (se suma este)",
  noPieces: "No hay piezas que puedas vincular. Podés crear una nueva.",
  linkNote: "Quedan vinculados: si cambiás el diseño, la pieza se actualiza sola mientras esté en Borrador, En producción o En revisión; si ya está programada, te pregunta; si ya se publicó, no se toca.",
  openPiece: "Abrir la pieza",
  sendChanges: "Enviar los cambios a la pieza",
  unlink: "Desvincular",
  unlinkTitle: "Desvincular el diseño",
  unlinkMessage: "Los archivos que ya están en la pieza se quedan. Solo deja de actualizarse cuando cambies el diseño.",
} as const;

export type ModalMode = "new" | "link";

export interface ModalState {
  mode: ModalMode;
  title: string;
  /** Las publicaciones elegidas: `platform:format`, una por red. */
  selected: string[];
  proposeCaption: boolean;
  query: string;
  pieceId: string | null;
  /** La red donde va el diseño al vincular. */
  platform: string | null;
}

export const networkKey = (n: Pick<ModalNetwork, "platform" | "format">): string => `${n.platform}:${n.format}`;

/**
 * Lo que arranca elegido al crear una pieza (como el prototipo): Instagram con la publicación que cuadra con las páginas
 * (carrusel si hay varias, imagen si hay una; una historia es una historia) y LinkedIn con el PDF si hay varias páginas.
 */
export function defaultSelection(networks: ModalNetwork[], pageCount: number): string[] {
  const many = pageCount > 1;
  const pick = (platform: string, wanted: (n: ModalNetwork) => boolean): string[] => {
    const options = networks.filter((n) => n.platform === platform);
    const match = options.find(wanted) ?? (options.length === 1 ? options[0] : undefined);
    return match ? [networkKey(match)] : [];
  };
  const instagram = pick("instagram", (n) => (n.format === "story" ? true : many ? n.format === "carousel" : n.format === "image"));
  const linkedin = many || instagram.length === 0 ? pick("linkedin", (n) => n.format === "pdf") : [];
  return [...instagram, ...linkedin];
}

export function initialModalState(data: UseInContentModalData): ModalState {
  return {
    mode: "new",
    title: data.designName,
    selected: defaultSelection(data.networks, data.pageCount),
    proposeCaption: data.canCopy,
    query: "",
    pieceId: null,
    platform: null,
  };
}

/** Elegir o sacar una publicación. Una sola por red: elegir otra de la misma red reemplaza a la anterior. */
export function toggleNetwork(selected: string[], network: Pick<ModalNetwork, "platform" | "format">): string[] {
  const key = networkKey(network);
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  return [...selected.filter((k) => !k.startsWith(`${network.platform}:`)), key];
}

/** Las redes de la pieza elegida donde puede ir el diseño, con la publicación que le toca a cada una. */
export function linkNetworkOptions(piece: PieceChoice | null, data: Pick<UseInContentModalData, "format" | "pageCount" | "networks">): Array<{ platform: string; format: string; label: string }> {
  if (!piece) return [];
  const platforms = [...new Set(data.networks.map((n) => n.platform))];
  const out: Array<{ platform: string; format: string; label: string }> = [];
  for (const platform of platforms) {
    const target = pickTargetForLink({ platform, designFormat: data.format, pageCount: data.pageCount, existingFormat: piece.networks.find((n) => n.platform === platform)?.format ?? null });
    if (target) out.push({ platform, format: target.format, label: target.label });
  }
  return out;
}

/** La red donde va el diseño al vincular: la elegida si sigue valiendo; si no, la de la pieza que ya tiene diseño de la red o la primera. */
export function resolveLinkPlatform(state: ModalState, options: Array<{ platform: string }>): string | null {
  if (state.platform && options.some((o) => o.platform === state.platform)) return state.platform;
  return options[0]?.platform ?? null;
}

export type Submission = { ok: true; input: UseInContentInput } | { ok: false; reason: string };

/** Qué se manda al confirmar, o por qué todavía no se puede. */
export function buildSubmission(designId: string, state: ModalState, data: UseInContentModalData, pieces: PieceChoice[]): Submission {
  if (state.mode === "new") {
    if (state.title.trim().length > 200) return { ok: false, reason: "El título va de 1 a 200 caracteres." };
    if (state.selected.length === 0) return { ok: false, reason: "Elegí al menos una red." };
    const networks = state.selected.flatMap((key) => {
      const found = data.networks.find((n) => networkKey(n) === key);
      return found ? [{ platform: found.platform, format: found.format }] : [];
    });
    if (networks.length === 0) return { ok: false, reason: "Elegí al menos una red." };
    return { ok: true, input: { designId, mode: "new", title: state.title.trim(), networks, proposeCaption: state.proposeCaption && data.canCopy } };
  }
  const piece = pieces.find((p) => p.id === state.pieceId) ?? null;
  if (!piece) return { ok: false, reason: "Elegí una pieza." };
  const platform = resolveLinkPlatform(state, linkNetworkOptions(piece, data));
  if (!platform) return { ok: false, reason: "Este diseño no sirve para ninguna red de esa pieza." };
  return { ok: true, input: { designId, mode: "link", postId: piece.id, platform } };
}

/** El texto de qué se exporta: «Se exportan las 5 láminas como PNG (y un PDF para LinkedIn)…». */
export function exportSummary(data: Pick<UseInContentModalData, "pageCount">, selected: string[]): string {
  const n = data.pageCount;
  const wantsPdf = selected.some((k) => k.endsWith(":pdf"));
  const onlyPdf = selected.length > 0 && selected.every((k) => k.endsWith(":pdf"));
  const sheets = `${n} ${n > 1 ? "láminas" : "imagen"}`;
  if (onlyPdf) return "Se exporta un PDF con todas las páginas, se suma a los archivos de la pieza y queda elegido en la red.";
  return `Se exportan las ${sheets} como PNG${wantsPdf ? " (y un PDF para LinkedIn)" : ""}, se suman a los archivos de la pieza y quedan elegidas en orden en la red.`;
}

/** Lo que muestra el menú «En contenido ▾» de la pieza vinculada. */
export function linkedMenuView(info: ContentLinkInfo | null): { title: string; summary: string; networks: ContentLinkInfo["networks"] } | null {
  if (!info) return null;
  return { title: info.title, summary: [info.statusLabel, ...info.networks.map((n) => n.label)].join(" · "), networks: info.networks };
}

/** Qué se le dice a la persona después de «Enviar los cambios a la pieza». */
export function syncMessage(data: SyncToPieceData): { tone: "ok" | "info"; text: string; openPiece: boolean } {
  if (data.published) return { tone: "info", text: "La pieza ya se publicó: los archivos publicados no se tocan.", openPiece: false };
  if (data.needsConfirmation) return { tone: "info", text: "La pieza está programada: confirmá en la pieza si querés actualizar los archivos.", openPiece: true };
  if (data.queued) return { tone: "ok", text: "Listo: los archivos de la pieza se actualizan en un momento.", openPiece: false };
  return { tone: "ok", text: "Ya hay una actualización en camino.", openPiece: false };
}
