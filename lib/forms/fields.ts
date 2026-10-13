/**
 * El modelo de un campo de formulario (F4). PURO y sin Zod: lo importan la
 * página pública, el builder y el servidor.
 *
 * Una definición es `{ fields: FormField[] }` (más `contractText` en los
 * contratos, que se congela aparte). Cada campo tiene una `key` estable: es la
 * clave de las respuestas guardadas y de `{{answer.<key>}}`, así que NO cambia
 * cuando se edita la etiqueta.
 */
import { SOCIAL_LABELS, type SocialPlatform } from "@/lib/contacts/social";
import type { VisibilityConfig } from "./visibility-types";
import type { EodChannel, EodChannelSelector } from "@/lib/eod/types";

export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "single_select",
  "multi_select",
  "date",
  "rating",
  "nps",
  "file",
  "consent",
  "hidden",
  "social",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Texto corto",
  long_text: "Texto largo",
  email: "Email",
  phone: "Teléfono",
  number: "Número",
  single_select: "Selección única",
  multi_select: "Selección múltiple",
  date: "Fecha",
  rating: "Estrellas (1 a 5)",
  nps: "NPS (0 a 10)",
  file: "Archivo",
  consent: "Casilla de consentimiento",
  hidden: "Campo oculto",
  social: "Usuario de red social",
};

export const FORM_TYPES = ["custom", "survey", "contract", "eod"] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  custom: "Personalizado",
  survey: "Encuesta",
  contract: "Contrato",
  eod: "Fin de día",
};

/**
 * Los tipos con página pública, envío público y disparador de formulario. Un EOD no
 * tiene ninguna de las tres cosas: se completa con la sesión iniciada.
 */
export type PublicFormType = Exclude<FormType, "eod">;

export function isPublicFormType(type: string): type is PublicFormType {
  return type === "custom" || type === "survey" || type === "contract";
}

/** Los tipos de pregunta de un reporte de fin de día: los demás no aplican (no hay contacto ni página pública). */
export const EOD_FIELD_TYPES = ["short_text", "long_text", "number", "single_select", "multi_select"] as const satisfies readonly FormFieldType[];

/** Qué tipos de campo se pueden usar en un formulario de este tipo. */
export function allowedFieldTypes(type: FormType): readonly FormFieldType[] {
  return type === "eod" ? EOD_FIELD_TYPES : FORM_FIELD_TYPES;
}

export const FORM_STATUSES = ["draft", "published", "paused", "archived"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
  draft: "Borrador",
  published: "Publicado",
  paused: "Pausado",
  archived: "Archivado",
};

/** Tipos de archivo que se pueden pedir (el servidor verifica el tipo REAL). */
export const ALLOWED_UPLOAD_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const FILE_LIMITS = { maxMb: 10, maxFiles: 3 } as const;
export const MAX_FIELDS = 60;
export const MAX_OPTIONS = 50;
export const MIN_OPTIONS = 2;

/** Cómo se comporta un campo prellenado desde la URL. */
export type PrefillBehavior = "editable" | "locked" | "hidden";
export interface PrefillConfig {
  /** Parámetros de URL que lo llenan, en orden de prioridad. Por defecto `[key]`. */
  params: string[];
  behavior: PrefillBehavior;
}

export const PREFILL_PARAM_RE = /^[a-zA-Z0-9_.-]{1,40}$/;
export const MAX_PREFILL_PARAMS = 5;

export type HiddenSource = "url_param" | "fixed" | "attribution";
export interface HiddenConfig {
  source: HiddenSource;
  /** `url_param`: el parámetro de la URL. `attribution`: la clave de atribución. */
  param?: string;
  /** `fixed`: el valor. NUNCA viaja al navegador. */
  value?: string;
}

export interface FileConfig {
  accept: string[];
  maxMb: number;
  maxFiles: number;
}

export interface FormField {
  id: string;
  key: string;
  type: FormFieldType;
  label: string;
  help?: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  file?: FileConfig;
  consentText?: string;
  hidden?: HiddenConfig;
  visibility?: VisibilityConfig;
  prefill?: PrefillConfig;
  /** Solo en `social`: de qué red es el usuario que se pide. */
  social?: { platform: SocialPlatform };
  /** Solo en `number` de un EOD: de a cuánto suman − y + (entero ≥ 1, por defecto 1). */
  step?: number;
  /** Solo en `number` de un EOD: qué mide la pregunta (`lib/eod/metrics.ts`). Suma entre canales. */
  metricKey?: string;
}

/** La copia de trabajo del editor. */
export interface FormDefinition {
  fields: FormField[];
  /** Solo contratos: el texto que se congela al publicar. */
  contractText?: string;
  /** Solo EOD de setters: la pregunta "¿Qué canales trabajaste hoy?". */
  channelSelector?: EodChannelSelector;
  /** Solo EOD de setters: los canales con sus preguntas. Se congelan al publicar, igual que `fields`. */
  channels?: EodChannel[];
}

/** Tipos que se pueden prellenar desde la URL. */
export function supportsPrefill(type: FormFieldType): boolean {
  return type !== "file" && type !== "consent";
}

/** Tipos cuya respuesta es una lista de opciones. */
export function hasOptions(type: FormFieldType): boolean {
  return type === "single_select" || type === "multi_select";
}

/** Lo que un campo de este tipo guarda como puntaje. */
export function isScoreType(type: FormFieldType): boolean {
  return type === "rating" || type === "nps";
}

export function newFieldId(): string {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

/** La etiqueta por defecto de un campo `social`: sale de la red ("Tu usuario de Instagram"). */
export function socialDefaultLabel(platform: SocialPlatform): string {
  return `Tu usuario de ${SOCIAL_LABELS[platform]}`;
}

/** Un campo nuevo con los valores razonables de su tipo. */
export function newField(type: FormFieldType, key: string, label?: string): FormField {
  const base: FormField = {
    id: newFieldId(),
    key,
    type,
    label: label ?? FIELD_TYPE_LABELS[type],
    required: false,
  };
  switch (type) {
    case "single_select":
    case "multi_select":
      return { ...base, options: ["Opción 1", "Opción 2"] };
    case "rating":
      return { ...base, min: 1, max: 5 };
    case "nps":
      return { ...base, min: 0, max: 10 };
    case "file":
      return { ...base, file: { accept: ["application/pdf", "image/jpeg", "image/png"], maxMb: 10, maxFiles: 1 } };
    case "consent":
      return { ...base, required: true, consentText: "Acepto los términos" };
    case "hidden":
      return { ...base, hidden: { source: "url_param", param: key } };
    case "social":
      return { ...base, label: label ?? socialDefaultLabel("instagram"), social: { platform: "instagram" } };
    default:
      return base;
  }
}

/** Un campo oculto: no se le muestra a quien responde. */
export function isHiddenField(field: FormField): boolean {
  return field.type === "hidden";
}

export function defaultDefinition(type: FormType): FormDefinition {
  if (type === "survey") {
    return {
      fields: [
        {
          id: newFieldId(),
          key: "nps",
          type: "nps",
          label: "¿Qué tan probable es que nos recomiendes?",
          required: true,
          min: 0,
          max: 10,
        },
        {
          id: newFieldId(),
          key: "por_que",
          type: "long_text",
          label: "¿Por qué?",
          required: false,
        },
      ],
    };
  }
  if (type === "contract") {
    return {
      fields: [
        { id: newFieldId(), key: "nombre", type: "short_text", label: "Nombre completo", required: true },
        { id: newFieldId(), key: "email", type: "email", label: "Email", required: true },
      ],
      contractText: "",
    };
  }
  return { fields: [] };
}
