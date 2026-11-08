/**
 * Las piezas de Contenido vistas desde el Diseñador IA (DS8): lo puro que arma las listas y los resúmenes del modal
 * «Usar en contenido» y del botón «Diseñar con el Diseñador IA» del drawer de la pieza. Sin base ni React.
 *
 * Una persona solo ve para vincular las piezas que puede ESCRIBIR (la misma regla del drawer: administrador siempre; un
 * Member la que creó o la que tiene asignada), porque vincular reescribe los archivos y las redes de la pieza.
 */

import { isAuthorOrAssignee } from "@/lib/content/assignee";
import { getFormat } from "@/lib/content/network-format";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { STATUS_LABELS } from "@/lib/content/status";
import { canWritePost } from "@/lib/content/piece-drawer";
import { platformLabel } from "@/lib/platforms";
import type { ContentPostStatus } from "@/lib/types/database";
import { CONTENT_TARGETS, contentTarget, targetsForPlatform } from "./content-map";
import { designGroups } from "./content-sync";
import type { MediaEntry } from "@/lib/content/media";

export interface PieceRow {
  id: string;
  title: string;
  status: string;
  networks: unknown;
  media: unknown;
  created_by: string | null;
  assigned_to: string | null;
}

/** Una pieza como la ofrece el buscador de «Vincular a una pieza existente». */
export interface PieceChoice {
  id: string;
  title: string;
  statusLabel: string;
  /** Sus redes, con el formato que ya tienen (para elegir en cuál va el diseño). */
  networks: Array<{ platform: string; label: string; format: string | null }>;
  /** «Borrador · Instagram Carrusel · LinkedIn Carrusel PDF». */
  summary: string;
  /** Ya tiene archivos de un diseño (el modal avisa «ya tiene un diseño (se suma este)»). */
  hasDesign: boolean;
}

const asNetworks = (value: unknown): NetworkEntry[] => (Array.isArray(value) ? (value as NetworkEntry[]) : []);

const statusLabel = (status: string): string => STATUS_LABELS[status as ContentPostStatus] ?? status;

/** «Instagram Carrusel»: la red y el formato de Contenido, o solo la red si todavía no tiene uno. */
export function networkLabel(network: Pick<NetworkEntry, "platform" | "format">): string {
  const format = getFormat(network.platform, network.format ?? null);
  return format ? `${platformLabel(network.platform)} ${format.label}` : platformLabel(network.platform);
}

/** «Borrador · Instagram Carrusel · LinkedIn Carrusel PDF» (sin redes: «sin redes todavía»). */
export function pieceSummary(status: string, networks: NetworkEntry[]): string {
  return [statusLabel(status), networks.length === 0 ? "sin redes todavía" : networks.map(networkLabel).join(" · ")].join(" · ");
}

/**
 * Las piezas que la persona puede elegir, en el orden en que llegan (las más nuevas primero). Las que no puede escribir
 * no se ofrecen. `designedPostIds` son las piezas que ya tienen un diseño vinculado.
 */
export function pieceChoices(rows: PieceRow[], opts: { viewer: { id: string; role: string }; designedPostIds?: ReadonlySet<string> }): PieceChoice[] {
  return rows
    .filter((row) => canWritePost({ role: opts.viewer.role, isAuthor: isAuthorOrAssignee(opts.viewer.id, row) }))
    .map((row) => {
      const networks = asNetworks(row.networks);
      const media = (Array.isArray(row.media) ? row.media : []) as MediaEntry[];
      return {
        id: row.id,
        title: row.title,
        statusLabel: statusLabel(row.status),
        networks: networks.map((n) => ({ platform: n.platform, label: networkLabel(n), format: n.format ?? null })),
        summary: pieceSummary(row.status, networks),
        hasDesign: (opts.designedPostIds?.has(row.id) ?? false) || designGroups(media).length > 0,
      };
    });
}

/** Una red para la que se puede diseñar desde la pieza (el botón «✦ Diseñar con el Diseñador IA»). */
export interface DesignPlatformChoice {
  platform: string;
  label: string;
  /** La red todavía no está en la pieza: al elegirla se suma. */
  isNew: boolean;
}

/** Las redes del diseño de una pieza: las suyas que se arman con un diseño; si ninguna, todas las que se pueden sumar. */
export function designPlatformChoices(networks: NetworkEntry[]): DesignPlatformChoice[] {
  const own = networks.filter((n) => targetsForPlatform(n.platform).length > 0);
  if (own.length > 0) {
    return own.map((n) => ({ platform: n.platform, label: contentTarget(n.platform, n.format ?? null)?.label ?? platformLabel(n.platform), isNew: false }));
  }
  const platforms = [...new Set(CONTENT_TARGETS.map((t) => t.platform))];
  return platforms.map((platform) => ({ platform, label: platformLabel(platform), isNew: true }));
}
