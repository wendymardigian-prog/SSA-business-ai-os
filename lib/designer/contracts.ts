/**
 * Contratos del Diseñador IA (cierre de la Ola 1).
 *
 * Lo que un bloque le pide a otro: los tipos de las Server Actions de
 * `lib/actions/designer/*`, de los componentes que se montan en el editor y
 * las reexportaciones del documento, el render, el cliente del render, las
 * variables, la verificación y los links. Explicación en
 * `docs/designer/contratos.md`.
 *
 * Un subagente NO cambia este archivo: si necesita otra cosa, la pide en su
 * informe y la suma la sesión principal al integrar.
 *
 * Solo tipos y reexportaciones de módulos puros (se puede importar desde el navegador).
 */

import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { DesignDoc } from "./doc/schema";
import type { FormatKey } from "./formats";
import type { DocType } from "./verification";
import type { CustomVar, DateFormat } from "./variables/catalog";

// ─── Reexportaciones (1. documento y render, 4. variables, verificación y links) ──
export * from "./doc/schema";
export * from "./formats";
export { renderPageHTML, elementStyle, textInnerStyle, backgroundLayers, cssText, toReactStyle, renderText, type RenderMode, type RenderOptions, type CssDecl } from "./render/page-html";
export { variableGroups, variableInfo, sampleValues, customVarKey, formatDesignDate, CUSTOM_VAR_KEY_RE, type CustomVar, type DateFormat, type DesignVariable, type VariableGroup } from "./variables/catalog";
export {
  canVerify,
  verifyAfterFormatChange,
  verificationText,
  verificationTitle,
  issueButtonLabel,
  alreadyValidNotice,
  docTypeNoun,
  docTypeVariable,
  validateTemplateVerification,
  verifyProposalText,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  VERIFY_TOGGLE_LABEL,
  FORMAT_NOT_VERIFIABLE,
  type DocType,
} from "./verification";
export { designPublicUrl, designDownloadUrl, normalizeDesignCode, DESIGN_CODE_RE, type DesignLinks, type DownloadFormat } from "./public-links";

// ─── Comunes ─────────────────────────────────────────────────────────────────

export type DesignKind = "design" | "template";
export type CreateOrigin = "ai" | "image" | "html" | "blank";

/** El resultado de una Server Action del Diseñador IA: nunca lanza hacia la pantalla. */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Lo que responde una acción que todavía construye otro bloque. */
export const NOT_BUILT_YET = (ola: number): { ok: false; error: string } => ({ ok: false, error: `Todavía no está construido (Ola ${ola}).` });

export interface DesignTarget {
  kind: DesignKind;
  id: string;
}

/** Lo que el permiso deja hacer (se OCULTA lo que no da, nunca se deshabilita). */
export interface DesignerCan {
  view: boolean;
  edit: boolean;
  publish: boolean;
  generate: boolean;
  manage: boolean;
}

// ─── 5. Server Actions: DS2 (lib/actions/designer/designs.ts) ───────────────

export interface CreateDesignInput {
  kind: DesignKind;
  origin: CreateOrigin;
  format: FormatKey;
  multiPage: boolean;
  name?: string;
  /** Con IA: clave del estilo (de fábrica o propio). */
  style?: string | null;
  /** Con IA: el pedido. */
  prompt?: string;
  /** Con IA: imágenes ya subidas con `uploadDesignImageAction`. */
  attachments?: AiAttachment[];
  /** Desde una imagen: la imagen base ya subida (ruta de `design-assets`). */
  baseImagePath?: string;
  /** Desde una imagen, en plantillas: "Que la IA me proponga dónde van los textos" (F30, lo hace DS3). */
  proposeTexts?: boolean;
  /** Con IA o desde Contenido (DS8): contexto extra para el pedido. */
  contentContext?: ContentAiContext;
}

export type CreateDesignResult = ActionResult<{ id: string; kind: DesignKind; href: string }>;

/** Guardar con control de versión: con una `rev` vieja responde `conflict` (nunca pisa en silencio). */
export type SaveDocResult =
  | { ok: true; rev: number }
  | { ok: false; conflict: true; current: { doc: DesignDoc; rev: number } }
  | { ok: false; conflict?: false; error: string };

export interface VersionSummary {
  id: string;
  createdAt: string;
  reason: "ai" | "manual" | "publish" | "restore" | "generate" | "import";
  authorKind: "user" | "ai";
  authorName: string | null;
  /** El documento, para dibujar la miniatura en vivo (F48: no hay miniaturas renderizadas). */
  doc: DesignDoc;
}

export interface TemplateSettingsInput {
  id: string;
  format?: FormatKey;
  verify?: boolean;
  doc_type?: DocType | null;
  doc_type_label?: string | null;
  date_format?: DateFormat;
  allow_download?: boolean;
  custom_vars?: CustomVar[];
}

// ─── 5. Server Actions: DS3 (lib/actions/designer/ai.ts y settings.ts) ──────

/** Lo que se le pasa a la IA desde una pieza de Contenido (F62). */
export interface ContentAiContext {
  postId: string;
  network: string;
  script: string[];
  caption?: string | null;
  pillar?: string | null;
  offer?: string | null;
  funnelStage?: string | null;
}

export interface AiMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments: AiAttachment[];
  scopePage: number | null;
  changedPages: number[];
  summary: string | null;
  warnings: string[];
  proposal: { kind: "template_texts" | "enable_verification"; status: "pending" | "accepted" | "declined" } | null;
  pending: boolean;
}

export interface SendAiMessageInput extends DesignTarget {
  text: string;
  /** null = todo; un número = solo esa página (0 = la primera). */
  page: number | null;
  attachments?: AiAttachment[];
  /** La `rev` sobre la que se pidió (la IA aplica sobre esa y se fusiona con lo que cambió la persona). */
  baseRev: number;
}

// ─── 5. Server Actions: DS4 (lib/actions/designer/import.ts) ────────────────

export type HtmlImportKind = "web" | "slides";

export interface HtmlInspection {
  /** Identificador de la carga (los recursos ya subidos a `design-assets/<ws>/imports/<uploadId>/`). */
  uploadId: string;
  fileName: string;
  detected: { as: HtmlImportKind; format: FormatKey; pages: number; label: string };
  removed: { scripts: number; iframes: number; forms: number; other: number; summary: string | null };
  assets: { images: number; fonts: number };
}

// ─── 5. Server Actions: DS5 (lib/actions/designer/publish.ts) ───────────────

export type ExportKind = "pdf" | "zip" | "png";

export type ExportResult = ActionResult<{ status: "ready"; url: string; fileName: string } | { status: "preparing"; stamp: string }>;

export interface PublicOptions {
  allowDownload?: boolean;
  allowIndexing?: boolean;
}

// ─── 5. Server Actions: DS6 (lib/actions/designer/generate.ts) ──────────────

/** Si falta un dato (F55). */
export type MissingPolicy = "fail" | "template_default" | "empty";

export interface GenerateOneInput {
  templateId: string;
  contactId: string | null;
  subjectRef?: { module: string; type: string; id: string; label: string } | null;
  /** Valores puestos a mano (propias, o del sistema "cambiar solo para esta pieza"). */
  overrides: Record<string, string>;
  publish: boolean;
  email?: { subject: string; body: string } | null;
  /** Si ya tiene una válida y la plantilla verifica: true = anular la anterior y generar otra. */
  replaceExisting?: boolean;
}

export interface GenerationPreview {
  values: Record<string, string>;
  missing: { key: string; label: string }[];
  existingValid: { designId: string; code: string } | null;
}

export interface GenerateManyInput {
  templateId: string;
  /** Los parámetros de URL de Contactos (los mismos filtros, como Broadcasts). */
  audienceParams: string;
  skipExisting: boolean;
  publish: boolean;
  email?: { subject: string; body: string } | null;
}

// ─── 5. Server Actions: DS8 (lib/actions/designer/content.ts) ───────────────

export type UseInContentInput =
  | { designId: string; mode: "new"; title: string; networks: { platform: string; format: string }[]; proposeCaption: boolean }
  | { designId: string; mode: "link"; postId: string; platform: string };

// ─── 6. Puntos de montaje (props de los componentes placeholder) ────────────

export interface AiPanelProps {
  target: DesignTarget;
  format: FormatKey;
  isTemplate: boolean;
  /** La página que se ve (0 = la primera). */
  currentPage: number;
  pageCount: number;
  rev: number;
  styleKey: string | null;
  canEdit: boolean;
  /** La IA guardó cambios: el editor vuelve a leer el documento. */
  onApplied: () => void;
}

export interface HtmlStepProps {
  kind: DesignKind;
  /** Lo que eligió la persona (o null mientras no hay archivo leído). */
  onChange: (state: { uploadId: string; as: HtmlImportKind } | null) => void;
}

export interface PublishMenuProps {
  designId: string;
  format: FormatKey;
  published: boolean;
  allowDownload: boolean;
  allowIndexing: boolean;
  /** Armados en el servidor con el dominio del negocio (nunca en el navegador). */
  links: { link: string; pdfUrl: string } | null;
  can: Pick<DesignerCan, "publish" | "generate">;
  /** Si es una generación con verificación (anular desde el menú). */
  verification: { docType: DocType | null; docTypeLabel: string | null; status: "valid" | "void" } | null;
}

export interface ExportMenuProps {
  target: DesignTarget;
  format: FormatKey;
  currentPage: number;
  pageCount: number;
  /** Plantillas: "Exportar prueba" con datos de ejemplo. */
  isTemplate: boolean;
}

export interface GenerateModalProps {
  templateId: string;
  open: boolean;
  onClose: () => void;
}

export interface GenerationsTabProps {
  templateId: string;
  can: Pick<DesignerCan, "generate">;
}

export interface UseInContentProps {
  designId: string;
  format: FormatKey;
  linkedPostId: string | null;
  linkedNetwork: string | null;
}

export interface AutomateModalProps {
  templateId: string;
  open: boolean;
  onClose: () => void;
}
