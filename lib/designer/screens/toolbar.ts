/**
 * La barra superior del editor (F17): qué acciones muestra según el tipo (diseño, generación o plantilla), el formato y
 * lo que el permiso deja hacer.
 *
 * Lo que el permiso no da se OCULTA (no se deshabilita). Lo que no aplica al formato se deshabilita con su motivo
 * (exportar una página web). Los rótulos salen de acá: «Publicar» / «● Publicado ▾», «Exportar prueba ▾», «Emitir
 * constancia» / «Generar para…».
 *
 *   - **Diseño:** Usar en contenido / En contenido ▾ (solo formatos de redes), Exportar ▾, Publicar.
 *   - **Plantilla:** pestañas Diseño · Generaciones (N), Exportar prueba ▾, Automatizar y el botón principal
 *     «Emitir <tipo>» (si verifica) o «Generar para…».
 *   - **⚙ Configuración** en los dos.
 *
 * Módulo puro.
 */

import type { DesignerCan, DesignKind } from "../contracts";
import { FORMATS, FORMAT_KEYS, canExport, type FormatKey } from "../formats";
import { issueButtonLabel, type DocType } from "../verification";

/** Los formatos con los que «Usar en contenido» tiene sentido: los de redes, los PDF de LinkedIn y las presentaciones. */
export const CONTENT_FORMATS: readonly FormatKey[] = ["sq", "v45", "story", "carta_v", "wide"];

export interface EditorDesign {
  kind: DesignKind;
  format: FormatKey;
  /** `ai`, `image`, `html`, `blank` o `template`. */
  origin: string;
  published: boolean;
  /** Una generación (un diseño que salió de una plantilla). */
  isGeneration: boolean;
  /** Estado de una generación (`ready`, `failed`, `void`, `queued`…). */
  status: string;
  archived: boolean;
  /** Plantillas. */
  verify: boolean;
  docType: DocType | string | null;
  docTypeLabel: string | null;
  generationsCount: number;
  /** Diseños: ya está vinculado a una pieza de Contenido. */
  linkedToContent: boolean;
}

/** Los permisos del Diseñador IA más el de Automatizaciones (el nodo lo usa quien edita automatizaciones). */
export interface EditorCan extends DesignerCan {
  automate?: boolean;
}

export type StatusTone = "ok" | "off" | "pur" | "warn" | "bad" | "act";

export interface EditorActions {
  back: { label: string; href: string };
  format: { mode: "select" | "fixed"; label: string; options: FormatKey[] };
  status: { label: string; tone: StatusTone };
  /** Solo plantillas: las pestañas Diseño · Generaciones (N). */
  tabs: { id: "diseno" | "generaciones"; label: string }[] | null;
  useInContent: { visible: boolean; label: string };
  exportMenu: { visible: boolean; label: string; enabled: boolean; disabledReason: string | null };
  publish: { visible: boolean; label: string; published: boolean };
  automate: { visible: boolean };
  /** El botón principal de una plantilla: «Emitir constancia» / «Generar para…». */
  primary: { visible: boolean; label: string };
  generateMany: { visible: boolean };
  config: { visible: boolean };
}

/** Los formatos a los que se puede cambiar: del mismo tipo (una página web solo es web). */
export function formatChoices(format: FormatKey): FormatKey[] {
  return FORMAT_KEYS.filter((key) => (key === "web") === (format === "web"));
}

const GENERATION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ready: { label: "Generado", tone: "ok" },
  failed: { label: "Falló", tone: "bad" },
  void: { label: "Anulado", tone: "bad" },
  queued: { label: "En proceso", tone: "act" },
  rendering: { label: "En proceso", tone: "act" },
  draft: { label: "Borrador", tone: "off" },
};

function statusOf(design: EditorDesign): EditorActions["status"] {
  if (design.archived) return { label: "Archivado", tone: "warn" };
  if (design.kind === "template") return { label: "Plantilla", tone: "pur" };
  if (design.isGeneration) return GENERATION_STATUS[design.status] ?? { label: "Generado", tone: "ok" };
  return design.published ? { label: "Publicado", tone: "ok" } : { label: "Borrador", tone: "off" };
}

/** Todo lo que muestra la barra superior del editor, según el diseño y los permisos. */
export function editorActions(design: EditorDesign, can: EditorCan): EditorActions {
  const isTemplate = design.kind === "template";
  const def = FORMATS[design.format];
  const fixedLabel = design.origin === "html" ? `${def.label} · del archivo` : def.label;
  const options = formatChoices(design.format);
  const canChangeFormat = can.edit && design.origin !== "html" && !design.isGeneration && !design.archived && options.length > 1;

  const exportable = canExport(design.format);
  const contentEligible = !isTemplate && !design.isGeneration && CONTENT_FORMATS.includes(design.format);

  return {
    back: isTemplate ? { label: "Plantillas", href: "/dashboard/disenos?tab=plantillas" } : { label: "Diseños", href: "/dashboard/disenos" },
    format: { mode: canChangeFormat ? "select" : "fixed", label: canChangeFormat ? def.label : fixedLabel, options: canChangeFormat ? options : [] },
    status: statusOf(design),
    tabs: isTemplate
      ? [
          { id: "diseno", label: "Diseño" },
          { id: "generaciones", label: `Generaciones (${design.generationsCount})` },
        ]
      : null,
    useInContent: { visible: contentEligible && can.edit && !design.archived, label: design.linkedToContent ? "En contenido ▾" : "Usar en contenido" },
    exportMenu: {
      visible: can.edit,
      label: isTemplate ? "Exportar prueba ▾" : "Exportar ▾",
      enabled: exportable,
      disabledReason: exportable ? null : "Una página web se comparte con su link: no se exporta.",
    },
    publish: { visible: !isTemplate && can.publish && !design.archived, label: design.published ? "● Publicado ▾" : "Publicar", published: design.published },
    automate: { visible: isTemplate && !!can.automate },
    primary: {
      visible: isTemplate && can.generate && !design.archived,
      label: issueButtonLabel({ verify: design.verify, doc_type: design.docType, doc_type_label: design.docTypeLabel }),
    },
    generateMany: { visible: isTemplate && can.generate && !design.archived },
    config: { visible: can.view },
  };
}

/** Los textos de la barra de guardado: «Guardado», «Guardando…», «Sin conexión: se guarda al volver». */
export const SAVE_LABELS = {
  saved: "Guardado",
  saving: "Guardando…",
  dirty: "Cambios sin guardar",
  offline: "Sin conexión: se guarda al volver",
  conflict: "Alguien más cambió este diseño",
  error: "No se pudo guardar",
} as const;
