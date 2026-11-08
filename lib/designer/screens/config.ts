/**
 * El drawer de Configuración (F28): qué secciones tiene según el tipo, y las reglas de archivar y borrar.
 *
 *   formato y medidas · imagen de fondo (si hay una) · marca · formato de fechas (plantillas) · «Al generar»
 *   (plantillas: descarga y verificación) · «Dónde se usa» (plantillas) · «Origen» (generaciones) · Versiones ·
 *   Duplicar · Archivar · Borrar (solo borradores sin uso, con `designer.manage`).
 *
 * Archivar: un diseño PUBLICADO pide confirmación y se despublica antes. Una pieza emitida (una generación) no se
 * archiva ni se borra: se anula (es lo que recibió la persona). Borrar definitivamente: solo borradores sin uso y con
 * `designer.manage`; uno con generaciones, publicado alguna vez o vinculado a una pieza de Contenido, NUNCA.
 *
 * La verificación («Se puede verificar» y el tipo de documento) solo existe en formatos impresos: al pasar a otro
 * formato se apaga sola con el aviso «Este formato no admite verificación».
 *
 * Módulo puro. El servidor vuelve a decidir con lo que lee de la base: esto es lo que se ve en pantalla.
 */

import type { DesignKind } from "../contracts";
import { canVerify, FORMAT_NOT_VERIFIABLE, verifyAfterFormatChange } from "../verification";
import type { FormatKey } from "../formats";

export type ConfigSectionId = "format" | "fit" | "brand" | "dates" | "generate" | "uses" | "origin" | "versions" | "more";

export interface ConfigInput {
  kind: DesignKind;
  isGeneration: boolean;
  /** El documento tiene alguna página con imagen de fondo. */
  hasBackgroundImage: boolean;
}

/** Las secciones del drawer, en orden. */
export function configSections(input: ConfigInput): ConfigSectionId[] {
  const sections: ConfigSectionId[] = ["format"];
  if (input.hasBackgroundImage) sections.push("fit");
  sections.push("brand");
  if (input.kind === "template") sections.push("dates", "generate", "uses");
  if (input.isGeneration) sections.push("origin");
  sections.push("versions", "more");
  return sections;
}

export const SECTION_TITLES: Record<ConfigSectionId, string> = {
  format: "Formato y medidas",
  fit: "Imagen de fondo",
  brand: "Marca",
  dates: "Formato de fechas",
  generate: "Al generar",
  uses: "Dónde se usa",
  origin: "Origen",
  versions: "Versiones",
  more: "Más",
};

export const FIT_OPTIONS = [
  { value: "cover", label: "Cubrir toda la página" },
  { value: "contain", label: "Ajustar sin recortar" },
] as const;

// ─── Archivar ────────────────────────────────────────────────────────────────

export interface ArchiveInput {
  kind: DesignKind;
  published: boolean;
  isGeneration: boolean;
  archived: boolean;
}

export type ArchiveDecision =
  | { action: "archive"; unpublish: boolean }
  | { action: "confirm"; message: string }
  | { action: "blocked"; reason: string }
  | { action: "already" };

export const ARCHIVE_CONFIRM_MESSAGE = "Este diseño está publicado. Si lo archivás, se despublica y su link deja de funcionar. ¿Lo archivamos igual?";
export const GENERATION_NOT_ARCHIVABLE = "Una pieza emitida no se archiva: si hace falta, se anula desde su plantilla.";

/** Qué pasa al apretar «Archivar»: archivar, pedir confirmación (publicado) o no se puede (una pieza emitida). */
export function archiveDecision(input: ArchiveInput, confirmedUnpublish: boolean): ArchiveDecision {
  if (input.archived) return { action: "already" };
  if (input.isGeneration) return { action: "blocked", reason: GENERATION_NOT_ARCHIVABLE };
  if (input.kind === "design" && input.published) {
    return confirmedUnpublish ? { action: "archive", unpublish: true } : { action: "confirm", message: ARCHIVE_CONFIRM_MESSAGE };
  }
  return { action: "archive", unpublish: false };
}

// ─── Borrar ──────────────────────────────────────────────────────────────────

export interface DeleteInput {
  kind: DesignKind;
  isGeneration: boolean;
  published: boolean;
  /** Se publicó alguna vez (su link pudo haberse compartido). */
  everPublished: boolean;
  generationsCount: number;
  linkedToContent: boolean;
  canManage: boolean;
}

/** Los motivos por los que NO se puede borrar (vacío = se puede). Solo borradores sin uso, y solo con `designer.manage`. */
export function deleteBlockers(input: DeleteInput): string[] {
  const reasons: string[] = [];
  if (!input.canManage) reasons.push("Borrar definitivamente lo hace quien administra el Diseñador IA.");
  if (input.isGeneration) reasons.push("Una pieza emitida no se borra: se anula.");
  if (input.published) reasons.push("Está publicado: despublicalo primero.");
  else if (input.everPublished) reasons.push("Se publicó alguna vez y su link pudo compartirse: se archiva, no se borra.");
  if (input.generationsCount > 0) reasons.push(`Tiene ${input.generationsCount === 1 ? "1 pieza generada" : `${input.generationsCount} piezas generadas`}: se archiva, no se borra.`);
  if (input.linkedToContent) reasons.push("Está vinculado a una pieza de Contenido: desvinculalo primero.");
  return reasons;
}

export function canDelete(input: DeleteInput): boolean {
  return deleteBlockers(input).length === 0;
}

// ─── Verificación al cambiar de formato ──────────────────────────────────────

export interface FormatChangeOutcome {
  verify: boolean;
  /** «Este formato no admite verificación», si se apagó sola. */
  notice: string | null;
}

/** Cambiar el formato de una plantilla: si el nuevo no admite verificación, se apaga sola con el aviso. */
export function formatChangeOutcome(template: { verify: boolean }, newFormat: FormatKey): FormatChangeOutcome {
  return verifyAfterFormatChange(template, newFormat);
}

/** Si el interruptor «Se puede verificar» y el selector de tipo se muestran: solo en formatos impresos. */
export function showsVerification(format: FormatKey): boolean {
  return canVerify(format);
}

export { FORMAT_NOT_VERIFIABLE };
