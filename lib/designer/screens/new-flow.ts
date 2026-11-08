/**
 * El modal «Nuevo diseño / Nueva plantilla» de tres pasos (F16, §11.3).
 *
 *   1. **Qué:** Diseño o Plantilla.
 *   2. **Cómo empezás:** Con IA · Desde una imagen · Cargar un archivo HTML · En blanco.
 *   3. Según el camino: **Formato y detalles** (Una página / Varias páginas → formatos permitidos; con IA: estilo,
 *      pedido e imágenes; desde una imagen: la imagen base y, en plantillas, «Que la IA me proponga…») o **Archivo**
 *      (cargar HTML: el formato sale del archivo, no se pide).
 *
 * Todo lo que decide el modal está acá, puro: qué formatos se ofrecen, cuándo se puede avanzar, por qué «Crear»
 * está deshabilitado y qué se le manda al servidor.
 *
 * Módulo puro.
 */

import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { CreateDesignInput, CreateOrigin, DesignKind } from "../contracts";
import { FORMATS, formatsForNew, type FormatKey } from "../formats";

export type NewStep = 1 | 2 | 3;

export interface NewImage {
  path: string;
  name: string;
}

export interface NewFlowState {
  step: NewStep;
  kind: DesignKind;
  how: CreateOrigin;
  multiPage: boolean;
  format: FormatKey;
  /** Con IA: la clave del estilo (de fábrica o propio). */
  style: string | null;
  prompt: string;
  /** Con IA: imágenes ya subidas. */
  attachments: AiAttachment[];
  /** Desde una imagen: la imagen base ya subida. */
  baseImage: NewImage | null;
  /** Desde una imagen, en plantillas: «Que la IA me proponga dónde van los textos y las variables». */
  proposeTexts: boolean;
  /** Cargar HTML: lo que dejó el paso Archivo (null mientras no hay archivo leído). */
  html: { uploadId: string; as: "web" | "slides" } | null;
}

export const DEFAULT_NEW_FORMAT: FormatKey = "v45";

export function initialNewFlow(kind: DesignKind = "design"): NewFlowState {
  return { step: 1, kind, how: "ai", multiPage: true, format: DEFAULT_NEW_FORMAT, style: null, prompt: "", attachments: [], baseImage: null, proposeTexts: false, html: null };
}

export interface NewKindOption {
  key: DesignKind;
  title: string;
  description: string;
}

export const KIND_OPTIONS: readonly NewKindOption[] = [
  { key: "design", title: "Diseño", description: "Una pieza final: carrusel, historias, presentación, PDF o página web. Se publica con link y, si querés, se descarga." },
  {
    key: "template",
    title: "Plantilla",
    description: "Con variables, para generar diseños desde automatizaciones o a mano (certificados, bienvenidas, propuestas). Sin link público.",
  },
];

export interface NewHowOption {
  key: CreateOrigin;
  title: string;
  description: string;
}

export const HOW_OPTIONS: readonly NewHowOption[] = [
  { key: "ai", title: "Con IA", description: "Le contás qué querés y le subís tus imágenes. Después lo ajustás." },
  { key: "image", title: "Desde una imagen", description: "Subís tu diseño base (por ejemplo, tu certificado de Canva) y le ponés textos y variables encima." },
  { key: "html", title: "Cargar un archivo HTML", description: "Una landing o una presentación que ya hiciste con Claude u otra herramienta. Usa el formato del archivo." },
  { key: "blank", title: "En blanco", description: "Una página vacía con tu marca: agregás textos, imágenes y variables." },
];

export function modalTitle(kind: DesignKind): string {
  return kind === "template" ? "Nueva plantilla" : "Nuevo diseño";
}

/** Los nombres de los tres pasos, con el último según el camino. */
export function stepLabels(state: Pick<NewFlowState, "how">): [string, string, string] {
  return ["Qué", "Cómo empezás", state.how === "html" ? "Archivo" : "Formato y detalles"];
}

/** Si el camino pide elegir un formato. Con «Cargar HTML» no se pide: sale del archivo. */
export function needsFormat(how: CreateOrigin): boolean {
  return how !== "html";
}

/** Los formatos que ofrece el paso 3: `web` solo con «Una página» y solo en Diseños. */
export function formatOptions(state: Pick<NewFlowState, "multiPage" | "kind">): FormatKey[] {
  return formatsForNew({ multiPage: state.multiPage, template: state.kind === "template" });
}

/** Un cambio de estado deja siempre un formato permitido: si el elegido ya no se ofrece, vuelve al de siempre. */
function ensureFormat(state: NewFlowState): NewFlowState {
  const allowed = formatOptions(state);
  return allowed.includes(state.format) ? state : { ...state, format: allowed.includes(DEFAULT_NEW_FORMAT) ? DEFAULT_NEW_FORMAT : allowed[0] };
}

export function setKind(state: NewFlowState, kind: DesignKind): NewFlowState {
  return ensureFormat({ ...state, kind, proposeTexts: kind === "template" ? state.proposeTexts : false });
}

/** Cambiar de camino limpia lo que era del otro (la imagen base, las imágenes del pedido, el archivo). */
export function setHow(state: NewFlowState, how: CreateOrigin): NewFlowState {
  if (how === state.how) return state;
  return { ...state, how, attachments: [], baseImage: null, html: null, proposeTexts: false };
}

export function setMultiPage(state: NewFlowState, multiPage: boolean): NewFlowState {
  return ensureFormat({ ...state, multiPage });
}

export function setFormat(state: NewFlowState, format: FormatKey): NewFlowState {
  return formatOptions(state).includes(format) ? { ...state, format } : state;
}

/** Por qué «Siguiente» / «Crear» no se puede apretar (null = se puede). Es el texto que ve la persona. */
export function createDisabledReason(state: NewFlowState): string | null {
  if (state.step < 3) return null;
  switch (state.how) {
    case "html":
      return state.html ? null : "Cargá un archivo HTML para seguir.";
    case "image":
      return state.baseImage ? null : "Subí la imagen base para seguir.";
    case "ai": {
      const hasPrompt = state.prompt.trim().length >= 3;
      return hasPrompt || state.attachments.length > 0 ? null : "Contale a la IA qué querés.";
    }
    default:
      return null;
  }
}

export function canCreate(state: NewFlowState): boolean {
  return state.step === 3 && createDisabledReason(state) === null;
}

export function nextStep(state: NewFlowState): NewFlowState {
  return state.step < 3 ? { ...state, step: (state.step + 1) as NewStep } : state;
}

export function prevStep(state: NewFlowState): NewFlowState {
  return state.step > 1 ? { ...state, step: (state.step - 1) as NewStep } : state;
}

/** El rótulo del botón principal. */
export function primaryLabel(state: Pick<NewFlowState, "step" | "how">): string {
  if (state.step < 3) return "Siguiente";
  if (state.how === "ai") return "Crear con IA";
  if (state.how === "html") return "Cargar";
  return "Crear";
}

/** Lo que se le manda al servidor para los caminos que crean ahí mismo (con IA, desde una imagen y en blanco). */
export function buildCreateInput(state: NewFlowState): CreateDesignInput {
  const base: CreateDesignInput = { kind: state.kind, origin: state.how, format: state.format, multiPage: state.multiPage };
  if (state.how === "ai") {
    return { ...base, style: state.style, prompt: state.prompt.trim(), attachments: state.attachments };
  }
  if (state.how === "image") {
    return { ...base, baseImagePath: state.baseImage?.path, proposeTexts: state.kind === "template" && state.proposeTexts };
  }
  return base;
}

/**
 * El tamaño del dibujito de un formato en la tarjeta del paso 3: la proporción real dentro de una caja de `box` px.
 * Una página web se dibuja alta y angosta, con una barra arriba (el prototipo).
 */
export function formatShape(format: FormatKey, box = 64): { width: number; height: number; web: boolean } {
  if (format === "web") return { width: Math.round(box * 0.85), height: Math.round(box * 1.1), web: true };
  const def = FORMATS[format];
  return def.width >= def.height
    ? { width: box, height: Math.round((box * def.height) / def.width), web: false }
    : { width: Math.round((box * def.width) / def.height), height: box, web: false };
}

/** La explicación de una línea debajo del selector «Una página / Varias páginas». */
export function pagesHelp(multiPage: boolean): string {
  return multiPage
    ? "Carrusel, secuencia de historias, presentación o un PDF de varias hojas."
    : "Un post, una historia, un certificado, un PDF de una hoja o una página web.";
}
